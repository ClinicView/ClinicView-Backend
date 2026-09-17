import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DocumentOcrReviewRevision, DocumentStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
// Match the existing CommonJS sharp factory without changing project-wide interop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharpModule = require('sharp');
import type { SharpConstructor } from 'sharp';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { IaClientService, ProcessResult } from '../../core/ia/ia-client.service';
import { MachineOcrLayout, OCR_IDENTIFIER, OcrBox } from '../../core/ia/ocr-layout';
import { IA_JOB_UUID } from '../../core/ia/ia-job.types';
import { SaveOcrLayoutReviewDto } from './dto/ocr-layout-review.dto';
import { OcrEvaluationSnapshotDto } from './dto/ocr-evaluation-snapshot.dto';
import { validateOcrReviewLines } from './ocr-layout-validation';
import { ProcessingFence } from './processing-job';

interface PageImage {
  storagePath: string;
  sha256: string;
  width: number;
  height: number;
}
type PageImages = Record<string, PageImage>;
const sharp = sharpModule as unknown as SharpConstructor;

/** Local publication cannot fit its preserved-page budget; repeating OCR cannot fix it. */
export class OcrPublicationLimitError extends Error {
  constructor() {
    super('OCR preserved-page cache exceeds the publication limit.');
    this.name = 'OcrPublicationLimitError';
  }
}

function revisionMetadata(revision: DocumentOcrReviewRevision) {
  return {
    revision: revision.revision,
    documentVersion: revision.documentVersion,
    recordedAt: revision.createdAt,
    recordedBy: {
      id: revision.recordedBy,
      username: revision.recordedByUsername,
      fullName: revision.recordedByName,
    },
    reason: revision.reason,
  };
}

@Injectable()
export class OcrLayoutService {
  private readonly logger = new Logger(OcrLayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ia: IaClientService,
  ) {}

  /** Cache immutable preprocessed pages before publishing a run to reviewers. */
  async completeProcessing(
    documentId: string,
    patientId: string,
    processingVersion: number,
    result: ProcessResult & { layout: MachineOcrLayout },
    userId?: string,
    fence?: ProcessingFence,
  ): Promise<void> {
    const pageImages: PageImages = {};
    const savedPaths: string[] = [];
    // A bounded cache protects the server from pathological multi-page inputs.
    const maxTotalBytes = 256 * 1024 * 1024;
    let totalBytes = 0;
    let publicationAttempted = false;
    let rejectedLocally = false;
    try {
      for (const page of result.layout.pages) {
        if (totalBytes >= maxTotalBytes) {
          if (fence) throw new OcrPublicationLimitError();
          break;
        }
        try {
          const bytes = await this.ia.getPageImage(documentId, result.layout.runId, page.page);
          if (totalBytes + bytes.length > maxTotalBytes) {
            if (fence) throw new OcrPublicationLimitError();
            break;
          }
          const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
          if (
            metadata.format !== 'png' ||
            metadata.width !== page.width ||
            metadata.height !== page.height
          ) {
            throw new Error('Page dimensions differ from OCR coordinates.');
          }
          const path = await this.storage.save(
            bytes,
            `${page.page}-${randomUUID()}.png`,
            `${patientId}/ocr/${documentId}/${result.layout.runId}`,
          );
          savedPaths.push(path);
          pageImages[String(page.page)] = {
            storagePath: path,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            width: page.width,
            height: page.height,
          };
          totalBytes += bytes.length;
        } catch (error) {
          if (error instanceof OcrPublicationLimitError) throw error;
          // Geometry remains useful, but never pretend the correct page image is available.
          this.logger.warn(
            `OCR page artifact unavailable for document ${documentId}, page ${page.page}.`,
          );
        }
      }
      if (fence && Object.keys(pageImages).length !== result.layout.pages.length) {
        throw new Error('OCR page cache incomplete; keep the durable result for reconciliation.');
      }
      publicationAttempted = true;
      await this.prisma.$transaction(async (tx) => {
        if (fence) {
          const finished = await tx.documentProcessingJob.updateMany({
            where: {
              id: fence.jobId,
              leaseToken: fence.leaseToken,
              status: 'FINALIZING',
              documentId,
              documentVersion: processingVersion,
            },
            data: {
              status: 'SUCCEEDED',
              completedAt: new Date(),
              leaseToken: null,
              leaseUntil: null,
              error: Prisma.DbNull,
            },
          });
          if (finished.count !== 1) {
            rejectedLocally = true;
            throw new ConflictException('El intento perdió su reserva de procesamiento.');
          }
        }
        const updated = await tx.medicalDocument.updateMany({
          where: {
            id: documentId,
            patientId,
            status: DocumentStatus.PROCESSING,
            version: processingVersion,
          },
          data: {
            status: DocumentStatus.PROCESSED,
            ocrText: result.ocrText,
            nerEntities: result.entities as unknown as Prisma.InputJsonValue,
            metrics: result.metrics
              ? (result.metrics as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            ocrConfidence: result.ocrConfidence,
            confidenceLevel: result.confidenceLevel,
            processedAt: new Date(),
            ...(userId ? { updatedBy: userId } : {}),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          rejectedLocally = true;
          throw new ConflictException('El procesamiento ya no corresponde a la versión actual.');
        }
        await tx.documentOcrRun.create({
          data: {
            documentId,
            runId: result.layout.runId,
            machineLayout: result.layout as unknown as Prisma.InputJsonValue,
            pageImages: pageImages as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      await this.cleanUnpublishedPages(
        documentId,
        result.layout.runId,
        savedPaths,
        publicationAttempted,
        rejectedLocally,
      );
      throw error;
    }
  }

  /** A lost commit acknowledgement is not evidence that the transaction rolled back. */
  private async cleanUnpublishedPages(
    documentId: string,
    runId: string,
    savedPaths: readonly string[],
    publicationAttempted: boolean,
    rejectedLocally: boolean,
  ): Promise<void> {
    if (!savedPaths.length) return;
    let referenced: Set<string>;
    try {
      const published = await this.prisma.documentOcrRun.findUnique({
        where: { documentId_runId: { documentId, runId } },
        select: { pageImages: true },
      });
      if (!published) {
        // Even a successful read returning no row can precede an in-flight COMMIT.
        // Only pre-publication errors or our own callback rejection prove that
        // this call cannot later publish these newly allocated paths.
        if (publicationAttempted && !rejectedLocally) {
          this.logger.warn(
            'OCR publication could not be confirmed; new page files were preserved.',
          );
          return;
        }
        referenced = new Set();
      } else {
        const images = published.pageImages;
        if (!images || typeof images !== 'object' || Array.isArray(images)) throw new Error();
        referenced = new Set(
          Object.values(images).map((image) => {
            if (
              !image ||
              typeof image !== 'object' ||
              Array.isArray(image) ||
              typeof image.storagePath !== 'string' ||
              !image.storagePath
            )
              throw new Error();
            return image.storagePath;
          }),
        );
      }
    } catch {
      // Prefer a recoverable orphan to deleting a possibly published clinical image.
      this.logger.warn('OCR publication verification unavailable; new page files were preserved.');
      return;
    }
    for (const path of savedPaths) {
      if (referenced.has(path)) continue;
      await this.storage
        .delete(path)
        .catch(() => this.logger.error('Unable to clean up a new unreferenced OCR page.'));
    }
  }

  async getLayout(patientId: string, documentId: string) {
    const document = await this.findDocument(this.prisma, patientId, documentId);
    const run = await this.prisma.documentOcrRun.findFirst({
      where: { documentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { revisions: { orderBy: { revision: 'desc' } } },
    });
    const base = {
      schemaVersion: 1 as const,
      documentVersion: document.version,
      documentStatus: document.status,
      assignedReviewerId: document.assignedReviewerId,
    };
    if (!run)
      return {
        ...base,
        available: false,
        reason: 'OCR_LAYOUT_UNAVAILABLE',
        runId: null,
        pages: [],
        review: null,
        revisions: [],
      };
    const layout = run.machineLayout as unknown as MachineOcrLayout;
    const images = run.pageImages as unknown as PageImages;
    const latest = run.revisions[0];
    return {
      ...base,
      available: true,
      runId: run.runId,
      pages: layout.pages.map((page) => ({
        ...page,
        imageAvailable: Boolean(images[String(page.page)]),
        ...(!images[String(page.page)]
          ? { imageUnavailableReason: 'PRESERVED_PAGE_UNAVAILABLE' }
          : {}),
      })),
      review: latest
        ? {
            ...revisionMetadata(latest),
            lines: latest.lines,
            stale: latest.correctedText !== (document.correctedText ?? '').trim(),
          }
        : null,
      revisions: run.revisions.map(revisionMetadata),
    };
  }

  async getRevision(patientId: string, documentId: string, runId: string, revision: number) {
    await this.findDocument(this.prisma, patientId, documentId);
    this.assertRunId(runId);
    if (!Number.isInteger(revision) || revision < 1)
      throw new BadRequestException('Revisión inválida.');
    const run = await this.prisma.documentOcrRun.findUnique({
      where: { documentId_runId: { documentId, runId } },
    });
    if (!run) throw new NotFoundException('Ejecución OCR no encontrada.');
    const found = await this.prisma.documentOcrReviewRevision.findUnique({
      where: { ocrRunId_revision: { ocrRunId: run.id, revision } },
    });
    if (!found) throw new NotFoundException('Revisión OCR no encontrada.');
    return {
      schemaVersion: 1 as const,
      runId,
      ...revisionMetadata(found),
      lines: found.lines,
      correctedText: found.correctedText,
      previousCorrection: found.previousCorrection,
    };
  }

  /** Read-only export. A reviewed fragment does not prove that an entire page was captured. */
  async getEvaluationSnapshot(
    patientId: string,
    documentId: string,
    runId: string,
    revision: number,
  ): Promise<OcrEvaluationSnapshotDto> {
    if (typeof runId !== 'string' || !IA_JOB_UUID.test(runId)) {
      throw new BadRequestException('La evaluación requiere el UUID exacto de la ejecución OCR.');
    }
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new BadRequestException('Revisión inválida.');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const document = await this.findDocument(tx, patientId, documentId);
        const run = await tx.documentOcrRun.findUnique({
          where: { documentId_runId: { documentId, runId } },
        });
        if (!run) throw new NotFoundException('Ejecución OCR no encontrada.');
        const review = await tx.documentOcrReviewRevision.findUnique({
          where: { ocrRunId_revision: { ocrRunId: run.id, revision } },
        });
        if (!review) throw new NotFoundException('Revisión OCR no encontrada.');

        const layout = run.machineLayout as unknown as MachineOcrLayout;
        if (layout.runId !== runId || !layout.pages?.length) {
          throw new ConflictException('La geometría original no corresponde a esta ejecución.');
        }
        const { lines, correctedText } = validateOcrReviewLines(
          layout,
          review.lines as unknown as SaveOcrLayoutReviewDto['lines'],
        );
        if (!lines.length || lines.some((line) => !line.reviewed)) {
          throw new ConflictException(
            'Contrasta y guarda todos los fragmentos antes de exportar el borrador de evaluación.',
          );
        }
        if (correctedText !== review.correctedText) {
          throw new ConflictException('El texto de la revisión no coincide con sus fragmentos.');
        }

        const jobs = await tx.documentProcessingJob.findMany({
          where: { documentId, processingRunId: runId, status: 'SUCCEEDED' },
          select: { sourceSha256: true },
        });
        const hashes = new Set(jobs.map((job) => job.sourceSha256));
        const sourceSha256 = jobs[0]?.sourceSha256;
        if (hashes.size !== 1 || !sourceSha256 || !/^[a-f0-9]{64}$/.test(sourceSha256)) {
          throw new ConflictException(
            'No hay una huella verificable del archivo original para esta ejecución. No se puede exportar.',
          );
        }

        const images = run.pageImages as unknown as PageImages;
        const predictionPages = layout.pages.map((page) => {
          const image = images?.[String(page.page)];
          if (
            !image ||
            !/^[a-f0-9]{64}$/.test(image.sha256) ||
            image.width !== page.width ||
            image.height !== page.height
          ) {
            throw new ConflictException(
              'Falta la huella de una página preservada de esta ejecución. No se puede exportar.',
            );
          }
          return {
            page: page.page,
            width: page.width,
            height: page.height,
            coordinateSpace: page.coordinateSpace,
            imageSha256: image.sha256,
            lines: page.lines.map((line) => ({
              lineId: line.lineId,
              text: line.text,
              order: line.order,
              bbox: [...line.bbox] as OcrBox,
              recognitionStatus: line.recognitionStatus,
            })),
          };
        });
        const reviewPages = predictionPages.map((page) => ({
          page: page.page,
          width: page.width,
          height: page.height,
          coordinateSpace: page.coordinateSpace,
          imageSha256: page.imageSha256,
          lines: lines
            .filter((line) => line.page === page.page)
            .map((line) => ({
              lineId: line.lineId,
              text: line.text,
              order: line.order,
              bbox: [...line.bbox] as OcrBox,
              sourceLineIds: [...line.sourceLineIds],
              reviewed: true as const,
            })),
        }));
        const currentRun = await tx.documentOcrRun.findFirst({
          where: { documentId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { runId: true },
        });
        const latestReview = await tx.documentOcrReviewRevision.findFirst({
          where: { ocrRunId: run.id },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        });
        const isCurrentRun = currentRun?.runId === runId;
        return {
          schemaVersion: 1,
          kind: 'clinicview-ocr-evaluation-snapshot',
          exportedAt: new Date().toISOString(),
          documentId,
          runId,
          revision,
          sourceSha256,
          provenance: {
            referenceKind: 'ocr_postedited',
            referenceDraft: true,
            pageCoverage: 'unassessed',
            clinicalValidationIsReference: false,
            referenceDocumentVersion: review.documentVersion,
            currentDocumentVersion: document.version,
            currentDocumentStatus: document.status,
            isCurrentRun,
            isLatestReview: latestReview?.revision === revision,
            staleAgainstCurrentCorrection:
              !isCurrentRun || review.correctedText !== (document.correctedText ?? '').trim(),
            reviewRecordedAt: review.createdAt.toISOString(),
          },
          prediction: { pages: predictionPages },
          review: { pages: reviewPages },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getPageImage(
    patientId: string,
    documentId: string,
    runId: string,
    page: number,
  ): Promise<Buffer> {
    await this.findDocument(this.prisma, patientId, documentId);
    this.assertRunId(runId);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('Página inválida.');
    const run = await this.prisma.documentOcrRun.findUnique({
      where: { documentId_runId: { documentId, runId } },
    });
    if (!run) throw new NotFoundException('Ejecución OCR no encontrada.');
    const image = (run.pageImages as unknown as PageImages)[String(page)];
    if (!image)
      throw new NotFoundException('La página preservada no está disponible para esta ejecución.');
    try {
      const bytes = await this.storage.readFile(image.storagePath);
      if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
        throw new Error('OCR page integrity mismatch.');
      }
      return bytes;
    } catch {
      throw new NotFoundException('La página preservada no está disponible para esta ejecución.');
    }
  }

  async saveReview(
    patientId: string,
    documentId: string,
    dto: SaveOcrLayoutReviewDto,
    actorId: string,
  ) {
    if (!actorId) throw new UnauthorizedException('Usuario autenticado requerido.');
    this.assertRunId(dto.runId);
    await this.prisma.$transaction(async (tx) => {
      const document = await this.findDocument(tx, patientId, documentId);
      if (document.status !== DocumentStatus.PROCESSED || document.assignedReviewerId !== actorId) {
        throw new ConflictException(
          'Toma la revisión de un documento procesado antes de editar sus líneas.',
        );
      }
      if (document.version !== dto.expectedVersion) {
        throw new ConflictException(
          'El documento cambió. Recarga antes de guardar la revisión espacial.',
        );
      }
      const run = await tx.documentOcrRun.findFirst({
        where: { documentId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!run || run.runId !== dto.runId) {
        throw new ConflictException(
          'La revisión corresponde a otra ejecución OCR. Recarga el documento.',
        );
      }
      const { lines, correctedText } = validateOcrReviewLines(
        run.machineLayout as unknown as MachineOcrLayout,
        dto.lines,
      );
      if (
        document.correctedText !== null &&
        document.correctedText.trim() !== correctedText &&
        dto.confirmTextReplacement !== true
      ) {
        throw new ConflictException(
          'Confirma el reemplazo del texto clínico corregido por el texto de esta revisión espacial.',
        );
      }
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { username: true, fullName: true, isActive: true },
      });
      if (!actor?.isActive) throw new UnauthorizedException('El revisor no está activo.');
      const updated = await tx.medicalDocument.updateMany({
        where: {
          id: documentId,
          patientId,
          status: DocumentStatus.PROCESSED,
          assignedReviewerId: actorId,
          version: dto.expectedVersion,
        },
        data: {
          correctedText,
          correctedAt: new Date(),
          correctedById: actorId,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('El documento cambió. No se guardó ninguna modificación.');
      }
      const latest = await tx.documentOcrReviewRevision.findFirst({
        where: { ocrRunId: run.id },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      await tx.documentOcrReviewRevision.create({
        data: {
          ocrRunId: run.id,
          revision: (latest?.revision ?? 0) + 1,
          documentVersion: dto.expectedVersion + 1,
          lines: lines as unknown as Prisma.InputJsonValue,
          correctedText,
          previousCorrection: {
            text: document.correctedText,
            entities: document.correctedEntities,
            documentVersion: document.version,
          } as Prisma.InputJsonValue,
          reason: dto.reason?.trim() || null,
          recordedBy: actorId,
          recordedByUsername: actor.username,
          recordedByName: actor.fullName,
        },
      });
    });
    return this.getLayout(patientId, documentId);
  }

  private async findDocument(
    client: Prisma.TransactionClient,
    patientId: string,
    documentId: string,
  ) {
    const document = await client.medicalDocument.findFirst({
      where: { id: documentId, patientId },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    return document;
  }

  private assertRunId(runId: string): void {
    if (typeof runId !== 'string' || !OCR_IDENTIFIER.test(runId)) {
      throw new BadRequestException('Identificador de ejecución requerido o inválido.');
    }
  }
}

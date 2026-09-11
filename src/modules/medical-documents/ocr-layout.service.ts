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
import { MachineOcrLayout, OCR_IDENTIFIER } from '../../core/ia/ocr-layout';
import { SaveOcrLayoutReviewDto } from './dto/ocr-layout-review.dto';
import { validateOcrReviewLines } from './ocr-layout-validation';

interface PageImage {
  storagePath: string;
  sha256: string;
  width: number;
  height: number;
}
type PageImages = Record<string, PageImage>;
const sharp = sharpModule as unknown as SharpConstructor;

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
  ): Promise<void> {
    const pageImages: PageImages = {};
    const savedPaths: string[] = [];
    // A bounded cache protects the server from pathological multi-page inputs.
    const maxTotalBytes = 256 * 1024 * 1024;
    let totalBytes = 0;
    for (const page of result.layout.pages) {
      if (totalBytes >= maxTotalBytes) break;
      try {
        const bytes = await this.ia.getPageImage(documentId, result.layout.runId, page.page);
        if (totalBytes + bytes.length > maxTotalBytes) break;
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
      } catch {
        // Geometry remains useful, but never pretend the correct page image is available.
        this.logger.warn(
          `OCR page artifact unavailable for document ${documentId}, page ${page.page}.`,
        );
      }
    }
    try {
      await this.prisma.$transaction(async (tx) => {
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
        if (updated.count !== 1)
          throw new ConflictException('El procesamiento ya no corresponde a la versión actual.');
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
      // Only these newly created UUID files may be removed; historical runs are untouched.
      for (const path of savedPaths) {
        await this.storage
          .delete(path)
          .catch(() => this.logger.error('Unable to clean up a new unreferenced OCR page.'));
      }
      throw error;
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

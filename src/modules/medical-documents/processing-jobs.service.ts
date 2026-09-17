import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DocumentProcessingJob, DocumentStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { IaClientService } from '../../core/ia/ia-client.service';
import { assertIaJobIdentity, IaJobHttpError, IaJobStatus } from '../../core/ia/ia-job.types';
import { StorageService } from '../../core/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OcrLayoutService, OcrPublicationLimitError } from './ocr-layout.service';
import {
  MedicalDocumentsRepository,
  MedicalDocumentWithAssignee,
} from './repositories/medical-documents.repository';
import { ACTIVE_PROCESSING_STATES, initialProgress, processingSnapshot } from './processing-job';

const LEASE_MS = 120_000;
const POLL_MS = 3_000;
type JobWithDocument = DocumentProcessingJob & {
  document: {
    id: string;
    patientId: string;
    version: number;
    status: DocumentStatus;
    storagePath: string;
    mimeType: string;
    originalName: string;
  };
};

@Injectable()
export class ProcessingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessingJobsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MedicalDocumentsRepository,
    private readonly storage: StorageService,
    private readonly ia: IaClientService,
    private readonly layouts: OcrLayoutService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    // Only pre-job legacy processing lacks a recoverable remote identity.
    await this.repo.failStaleProcessing();
    if (
      process.env.OCR_JOBS_WORKER_ENABLED === 'false' ||
      (process.env.NODE_ENV === 'test' && process.env.OCR_JOBS_WORKER_ENABLED !== 'true')
    )
      return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // Leases expire after shutdown. Never mark a still-running remote OCR failed.
  }

  async enqueue(doc: MedicalDocumentWithAssignee, userId?: string, expectedVersion?: number) {
    const current = doc.processingJobs?.[0];
    if (
      current &&
      ((expectedVersion !== undefined && current.documentVersion === expectedVersion + 1) ||
        (expectedVersion === undefined && doc.status === DocumentStatus.PROCESSING))
    )
      return doc;
    if (expectedVersion !== undefined && expectedVersion !== doc.version)
      throw new ConflictException('El documento cambió. Consulta su estado antes de reintentar.');
    if (
      ![DocumentStatus.PENDING, DocumentStatus.FAILED].includes(doc.status as 'PENDING' | 'FAILED')
    )
      throw new ConflictException(`No se puede procesar un documento con estado ${doc.status}.`);
    if (current && !processingSnapshot(current)?.canRetry)
      throw new ConflictException(
        'El intento anterior aún no está resuelto o necesita corregir el archivo/configuración.',
      );
    const bytes = await this.storage.readFile(doc.storagePath);
    if (bytes.length > 20 * 1024 * 1024)
      throw new PayloadTooLargeException(
        'La digitalización admite archivos de hasta 20 MiB. El documento permanece sin procesar.',
      );
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    const accepted = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.medicalDocument.updateMany({
        where: {
          id: doc.id,
          patientId: doc.patientId,
          version: doc.version,
          status: { in: [DocumentStatus.PENDING, DocumentStatus.FAILED] },
          patient: { isActive: true },
        },
        data: {
          status: DocumentStatus.PROCESSING,
          version: { increment: 1 },
          ...(userId ? { updatedBy: userId } : {}),
        },
      });
      if (claimed.count !== 1) return false;
      const previous = await tx.documentProcessingJob.findFirst({
        where: { documentId: doc.id },
        orderBy: { attempt: 'desc' },
      });
      await tx.documentProcessingJob.create({
        data: {
          documentId: doc.id,
          documentVersion: doc.version + 1,
          attempt: (previous?.attempt ?? 0) + 1,
          sourceSha256,
          progress: initialProgress() as unknown as Prisma.InputJsonValue,
          ...(userId ? { createdBy: userId } : {}),
        },
      });
      return true;
    });
    const updated = await this.repo.findByIdAndPatient(doc.id, doc.patientId);
    if (!updated || (!accepted && updated.processingJobs?.[0]?.documentVersion !== doc.version + 1))
      throw new ConflictException('El documento cambió antes de registrar la digitalización.');
    return updated;
  }

  /** Public for deterministic integration tests and a separately hosted worker. */
  async tick(): Promise<void> {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      const now = new Date();
      const jobs = await this.prisma.documentProcessingJob.findMany({
        where: {
          status: { in: ACTIVE_PROCESSING_STATES },
          nextPollAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        orderBy: [{ nextPollAt: 'asc' }, { createdAt: 'asc' }],
        take: 4,
        include: { document: true },
      });
      await Promise.all(jobs.map((job) => this.reconcile(job)));
    } catch {
      // Never log OCR text, file bytes, worker response bodies or credentials.
      this.logger.warn(
        'No se pudo consultar la cola OCR persistente. Se conservará para recuperar.',
      );
    } finally {
      this.busy = false;
    }
  }

  private async reconcile(job: JobWithDocument) {
    const token = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.documentProcessingJob.updateMany({
      where: {
        id: job.id,
        status: { in: ACTIVE_PROCESSING_STATES },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count !== 1) return;
    let owned = true;
    const renew = setInterval(() => {
      void this.prisma.documentProcessingJob
        .updateMany({
          where: { id: job.id, leaseToken: token, status: { in: ACTIVE_PROCESSING_STATES } },
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        })
        .then((r) => {
          if (r.count !== 1) owned = false;
        })
        .catch(() => {
          owned = false;
        });
    }, LEASE_MS / 3);
    renew.unref();
    try {
      if (
        job.document.status !== DocumentStatus.PROCESSING ||
        job.document.version !== job.documentVersion
      ) {
        await this.prisma.documentProcessingJob.updateMany({
          where: { id: job.id, leaseToken: token },
          data: {
            status: 'INTERRUPTED',
            completedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
            error: {
              code: 'DOCUMENT_CHANGED',
              message: 'El documento cambió; este intento no puede sobrescribirlo.',
              retryable: false,
            },
          },
        });
        return;
      }
      let remote: IaJobStatus;
      try {
        remote = await this.ia.getJob(job.id);
      } catch (error) {
        if (!(error instanceof IaJobHttpError) || error.statusCode !== 404) throw error;
        // Once acknowledged, a missing remote job indicates lost/mismatched
        // durable storage. Do not guess that its inference has stopped.
        if (job.submittedAt) throw new Error('Remote durable job is missing');
        const bytes = await this.storage.readFile(job.document.storagePath);
        if (createHash('sha256').update(bytes).digest('hex') !== job.sourceSha256) {
          await this.fail(job, token, 'FAILED', {
            code: 'SOURCE_CHANGED',
            message:
              'El archivo original cambió. No se enviará una versión diferente con el mismo intento.',
            retryable: false,
          });
          return;
        }
        try {
          remote = await this.ia.submitJob(
            job.id,
            job.documentId,
            job.sourceSha256,
            bytes,
            job.document.mimeType as 'image/jpeg' | 'image/png' | 'application/pdf',
          );
        } catch (submissionError) {
          if (
            submissionError instanceof IaJobHttpError &&
            [400, 413, 415, 422].includes(submissionError.statusCode)
          ) {
            await this.fail(job, token, 'FAILED', {
              code: 'SOURCE_REJECTED',
              message:
                'IA no admite este archivo o supera los límites de procesamiento. Revisa el original antes de cargar otro.',
              retryable: false,
            });
            return;
          }
          throw submissionError;
        }
      }
      assertIaJobIdentity(remote, job.documentId, job.sourceSha256);
      if (!owned || this.stopping) return;
      const status = remote.status === 'SUCCEEDED' ? 'FINALIZING' : remote.status;
      const updated = await this.prisma.documentProcessingJob.updateMany({
        where: { id: job.id, leaseToken: token, status: { in: ACTIVE_PROCESSING_STATES } },
        data: {
          status: ['FAILED', 'INTERRUPTED'].includes(status) ? job.status : status,
          submittedAt: job.submittedAt ?? new Date(),
          progress: remote.progress as unknown as Prisma.InputJsonValue,
          startedAt: remote.startedAt ? new Date(remote.startedAt) : null,
          heartbeatAt: remote.heartbeatAt ? new Date(remote.heartbeatAt) : null,
          processingRunId: remote.processingRunId,
          failures: 0,
          error: Prisma.DbNull,
        },
      });
      if (updated.count !== 1) return;
      if (remote.status === 'FAILED' || remote.status === 'INTERRUPTED') {
        await this.fail(
          job,
          token,
          remote.status,
          remote.error ?? {
            code: 'WORKER_INTERRUPTED',
            message: 'La digitalización se interrumpió. Puedes iniciar un nuevo intento.',
            retryable: true,
          },
        );
      } else if (remote.status === 'SUCCEEDED') {
        const result = await this.ia.getJobResult(job.id);
        if (!owned || this.stopping) return;
        if (
          result.documentId !== job.documentId ||
          result.processingRunId !== remote.processingRunId ||
          (result.layout && result.layout.runId !== remote.processingRunId)
        )
          throw new Error('Result identity mismatch');
        const fence = { jobId: job.id, leaseToken: token };
        if (result.layout) {
          await this.layouts.completeProcessing(
            job.documentId,
            job.document.patientId,
            job.documentVersion,
            { ...result, layout: result.layout },
            job.createdBy ?? undefined,
            fence,
          );
        } else {
          // Legacy/stub result: still atomic, but do not invent spatial geometry.
          await this.prisma.$transaction(async (tx) => {
            const changed = await tx.documentProcessingJob.updateMany({
              where: { id: job.id, leaseToken: token, status: 'FINALIZING' },
              data: {
                status: 'SUCCEEDED',
                completedAt: new Date(),
                leaseToken: null,
                leaseUntil: null,
              },
            });
            if (changed.count !== 1) throw new ConflictException('Lease lost');
            const completed = await tx.medicalDocument.updateMany({
              where: {
                id: job.documentId,
                patientId: job.document.patientId,
                version: job.documentVersion,
                status: DocumentStatus.PROCESSING,
              },
              data: {
                status: DocumentStatus.PROCESSED,
                version: { increment: 1 },
                ocrText: result.ocrText,
                nerEntities: result.entities as unknown as Prisma.InputJsonValue,
                metrics: result.metrics
                  ? (result.metrics as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                ocrConfidence: result.ocrConfidence,
                confidenceLevel: result.confidenceLevel,
                processedAt: new Date(),
              },
            });
            if (completed.count !== 1) throw new ConflictException('Document changed');
          });
        }
        await this.notify(job, true);
      } else {
        await this.prisma.documentProcessingJob.updateMany({
          where: { id: job.id, leaseToken: token },
          data: { nextPollAt: new Date(Date.now() + POLL_MS), leaseToken: null, leaseUntil: null },
        });
      }
    } catch (error) {
      if (error instanceof OcrPublicationLimitError) {
        await this.fail(job, token, 'FAILED', {
          code: 'ARTIFACT_CACHE_LIMIT',
          message:
            'El resultado OCR supera el límite de páginas preservadas. Se conserva en IA; requiere revisión técnica antes de continuar.',
          retryable: false,
        });
        return;
      }
      // A transport/HTTP/result/cache/database failure says nothing definitive
      // about remote inference. Keep the same UUID; reconnect, never duplicate.
      await this.prisma.documentProcessingJob
        .updateMany({
          where: { id: job.id, leaseToken: token, status: { in: ACTIVE_PROCESSING_STATES } },
          data: {
            status: 'WAITING_FOR_WORKER',
            failures: { increment: 1 },
            error: {
              code: 'WORKER_UNAVAILABLE',
              message:
                'No se pudo confirmar el resultado. Conservamos el intento y volveremos a consultar; no es necesario volver a cargar el archivo.',
              retryable: false,
            },
            nextPollAt: new Date(
              Date.now() + Math.min(60_000, POLL_MS * 2 ** Math.min(job.failures, 5)),
            ),
            leaseToken: null,
            leaseUntil: null,
          },
        })
        .catch(() => undefined);
    } finally {
      clearInterval(renew);
    }
  }

  private async fail(
    job: JobWithDocument,
    token: string,
    status: 'FAILED' | 'INTERRUPTED',
    error: { code: string; message: string; retryable: boolean },
  ) {
    const changed = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.documentProcessingJob.updateMany({
        where: { id: job.id, leaseToken: token, status: { in: ACTIVE_PROCESSING_STATES } },
        data: { status, error, completedAt: new Date(), leaseToken: null, leaseUntil: null },
      });
      if (locked.count !== 1) return false;
      const doc = await tx.medicalDocument.updateMany({
        where: {
          id: job.documentId,
          patientId: job.document.patientId,
          status: DocumentStatus.PROCESSING,
          version: job.documentVersion,
        },
        data: { status: DocumentStatus.FAILED, version: { increment: 1 } },
      });
      if (doc.count !== 1) throw new ConflictException('Document changed');
      return true;
    });
    if (changed) await this.notify(job, false);
  }

  private async notify(job: JobWithDocument, success: boolean) {
    if (!job.createdBy) return;
    await this.notifications
      .notify({
        userId: job.createdBy,
        type: success ? 'DOCUMENT_PROCESSED' : 'DOCUMENT_FAILED',
        title: success ? 'Digitalización completada' : 'Digitalización interrumpida',
        body: success
          ? `«${job.document.originalName}» está listo para revisión.`
          : `Revisa el estado de «${job.document.originalName}» antes de reintentar.`,
        patientId: job.document.patientId,
        documentId: job.documentId,
      })
      .catch(() =>
        this.logger.warn(
          'No se pudo enviar la notificación OCR; el estado persistido se conserva.',
        ),
      );
  }
}

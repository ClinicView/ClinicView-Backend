import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, PayloadTooLargeException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { ProcessingJobsService } from '../processing-jobs.service';
import { initialProgress } from '../processing-job';
import { IaJobHttpError, IaJobStatus } from '../../../core/ia/ia-job.types';
import { IaClientService } from '../../../core/ia/ia-client.service';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../../core/storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OcrLayoutService, OcrPublicationLimitError } from '../ocr-layout.service';
import {
  MedicalDocumentsRepository,
  MedicalDocumentWithAssignee,
} from '../repositories/medical-documents.repository';

const bytes = Buffer.from('Synthetic job source');
const hash = createHash('sha256').update(bytes).digest('hex');
const docId = '77f21af2-1111-4000-8000-111111111111';
const patientId = '77f21af2-2222-4000-8000-111111111111';
const jobId = '77f21af2-3333-4000-8000-111111111111';
function job() {
  return {
    id: jobId,
    documentId: docId,
    documentVersion: 4,
    attempt: 1,
    sourceSha256: hash,
    status: 'QUEUED',
    progress: initialProgress(),
    error: null,
    createdBy: 'synthetic-actor',
    createdAt: new Date(),
    updatedAt: new Date(),
    submittedAt: null,
    startedAt: null,
    completedAt: null,
    heartbeatAt: null,
    processingRunId: null,
    nextPollAt: new Date(),
    failures: 0,
    leaseToken: null,
    leaseUntil: null,
    document: {
      id: docId,
      patientId,
      version: 4,
      status: DocumentStatus.PROCESSING,
      storagePath: 'private/synthetic.pdf',
      mimeType: 'application/pdf',
      originalName: 'synthetic.pdf',
    },
  };
}
function remote(patch: Partial<IaJobStatus> = {}): IaJobStatus {
  const now = new Date().toISOString();
  return {
    jobId,
    documentId: docId,
    sourceSha256: hash,
    status: 'RUNNING',
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    heartbeatAt: now,
    processingRunId: null,
    progress: { ...initialProgress(), phase: 'PREPARING' },
    error: null,
    ...patch,
  };
}

describe('ProcessingJobsService durable reconciliation', () => {
  let service: ProcessingJobsService;
  const prisma = {
    documentProcessingJob: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    medicalDocument: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const repo = { failStaleProcessing: jest.fn(), findByIdAndPatient: jest.fn() };
  const storage = { readFile: jest.fn() };
  const ia = { getJob: jest.fn(), submitJob: jest.fn(), getJobResult: jest.fn() };
  const layouts = { completeProcessing: jest.fn() };
  const notifications = { notify: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.documentProcessingJob.findMany.mockResolvedValue([job()]);
    prisma.documentProcessingJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.medicalDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((action: (transaction: typeof prisma) => unknown) =>
      action(prisma),
    );
    repo.failStaleProcessing.mockResolvedValue(0);
    storage.readFile.mockResolvedValue(bytes);
    ia.getJob.mockResolvedValue(remote());
    ia.submitJob.mockResolvedValue(remote({ status: 'QUEUED', progress: initialProgress() }));
    ia.getJobResult.mockResolvedValue({
      documentId: docId,
      processingRunId: null,
      ocrText: 'Synthetic result',
      entities: [],
      metrics: null,
      ocrConfidence: 0.5,
      confidenceLevel: 'MEDIUM',
      layout: null,
    });
    notifications.notify.mockResolvedValue(undefined);
    service = new ProcessingJobsService(
      prisma as unknown as PrismaService,
      repo as unknown as MedicalDocumentsRepository,
      storage as unknown as StorageService,
      ia as unknown as IaClientService,
      layouts as unknown as OcrLayoutService,
      notifications as unknown as NotificationsService,
    );
  });
  afterEach(() => service.onModuleDestroy());

  it('does no remote work without an eligible job', async () => {
    prisma.documentProcessingJob.findMany.mockResolvedValue([]);
    await service.tick();
    expect(ia.getJob).not.toHaveBeenCalled();
  });

  it('does not inspect or submit a job owned by another lease', async () => {
    prisma.documentProcessingJob.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.tick();
    expect(ia.getJob).not.toHaveBeenCalled();
    expect(ia.submitJob).not.toHaveBeenCalled();
  });

  it('updates remote counters without changing the clinical document version', async () => {
    ia.getJob.mockResolvedValue(
      remote({
        progress: {
          ...initialProgress(),
          phase: 'RECOGNIZING',
          pagesTotal: 2,
          currentPage: 1,
          linesTotal: 20,
          linesCompleted: 4,
        },
      }),
    );
    await service.tick();
    expect(prisma.medicalDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.documentProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: jobId, leaseToken: expect.any(String) }),
        data: expect.objectContaining({
          status: 'RUNNING',
          progress: expect.objectContaining({ linesCompleted: 4 }),
        }),
      }),
    );
    expect(ia.submitJob).not.toHaveBeenCalled();
  });

  it('keeps ambiguous network failures recoverable without declaring OCR failed or posting again', async () => {
    ia.getJob.mockRejectedValue(new Error('SENSITIVE WORKER DETAIL'));
    await service.tick();
    expect(prisma.medicalDocument.updateMany).not.toHaveBeenCalled();
    expect(ia.submitJob).not.toHaveBeenCalled();
    expect(prisma.documentProcessingJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'WAITING_FOR_WORKER',
          error: expect.objectContaining({ retryable: false }),
        }),
      }),
    );
    expect(JSON.stringify(prisma.documentProcessingJob.updateMany.mock.calls)).not.toContain(
      'SENSITIVE WORKER DETAIL',
    );
  });

  it('does not resubmit a previously acknowledged job missing from IA durable storage', async () => {
    prisma.documentProcessingJob.findMany.mockResolvedValue([
      { ...job(), submittedAt: new Date() },
    ]);
    ia.getJob.mockRejectedValue(new IaJobHttpError(404));
    await service.tick();
    expect(ia.submitJob).not.toHaveBeenCalled();
    expect(prisma.medicalDocument.updateMany).not.toHaveBeenCalled();
  });

  it('submits the same UUID and source hash only after an unacknowledged 404', async () => {
    ia.getJob.mockRejectedValue(new IaJobHttpError(404));
    await service.tick();
    expect(ia.submitJob).toHaveBeenCalledTimes(1);
    expect(ia.submitJob).toHaveBeenCalledWith(jobId, docId, hash, bytes, 'application/pdf');
    expect(prisma.medicalDocument.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a changed source before submission and records a nonretryable failure', async () => {
    ia.getJob.mockRejectedValue(new IaJobHttpError(404));
    storage.readFile.mockResolvedValue(Buffer.from('different source'));
    await service.tick();
    expect(ia.submitJob).not.toHaveBeenCalled();
    expect(prisma.documentProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.objectContaining({ code: 'SOURCE_CHANGED', retryable: false }),
        }),
      }),
    );
    expect(prisma.medicalDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: docId,
          version: 4,
          status: DocumentStatus.PROCESSING,
        }),
        data: expect.objectContaining({ status: DocumentStatus.FAILED }),
      }),
    );
  });

  it('treats explicit invalid-input rejection as terminal but a conflict as uncertain', async () => {
    ia.getJob.mockRejectedValue(new IaJobHttpError(404));
    ia.submitJob.mockRejectedValue(new IaJobHttpError(413));
    await service.tick();
    expect(prisma.medicalDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DocumentStatus.FAILED }),
      }),
    );
    prisma.medicalDocument.updateMany.mockClear();
    ia.submitJob.mockRejectedValue(new IaJobHttpError(409));
    await service.tick();
    expect(prisma.medicalDocument.updateMany).not.toHaveBeenCalled();
  });

  it('records a definite remote interruption transactionally with the document failure', async () => {
    ia.getJob.mockResolvedValue(
      remote({
        status: 'INTERRUPTED',
        completedAt: new Date().toISOString(),
        error: { code: 'WORKER_RESTARTED', message: 'Synthetic interruption', retryable: true },
      }),
    );
    await service.tick();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.documentProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'INTERRUPTED',
          error: expect.objectContaining({ retryable: true }),
        }),
      }),
    );
    expect(prisma.medicalDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: DocumentStatus.FAILED, version: { increment: 1 } },
      }),
    );
  });

  it.each(['status document', 'status hash', 'result document', 'result run'])(
    'does not commit a mismatched %s',
    async (kind) => {
      ia.getJob.mockResolvedValue(
        remote({
          status: 'SUCCEEDED',
          completedAt: new Date().toISOString(),
          progress: { ...initialProgress(), phase: 'COMPLETE' },
          ...(kind === 'status document' ? { documentId: 'other' } : {}),
          ...(kind === 'status hash' ? { sourceSha256: '0'.repeat(64) } : {}),
        }),
      );
      if (kind === 'result document')
        ia.getJobResult.mockResolvedValue({ documentId: 'other', processingRunId: null });
      if (kind === 'result run')
        ia.getJobResult.mockResolvedValue({ documentId: docId, processingRunId: randomUUID() });
      await service.tick();
      expect(prisma.medicalDocument.updateMany).not.toHaveBeenCalled();
      expect(layouts.completeProcessing).not.toHaveBeenCalled();
    },
  );

  it('recovers a completed result with a fenced spatial transaction and tolerates notification failure', async () => {
    const runId = randomUUID();
    const layout = { schemaVersion: 1, runId, pages: [] };
    ia.getJob.mockResolvedValue(
      remote({
        status: 'SUCCEEDED',
        processingRunId: runId,
        completedAt: new Date().toISOString(),
        progress: { ...initialProgress(), phase: 'COMPLETE' },
      }),
    );
    ia.getJobResult.mockResolvedValue({
      documentId: docId,
      processingRunId: runId,
      layout,
      ocrText: 'Synthetic',
      entities: [],
      metrics: null,
      ocrConfidence: 0.7,
      confidenceLevel: 'MEDIUM',
    });
    notifications.notify.mockRejectedValue(new Error('Notification unavailable'));
    await service.tick();
    expect(layouts.completeProcessing).toHaveBeenCalledWith(
      docId,
      patientId,
      4,
      expect.objectContaining({ layout }),
      'synthetic-actor',
      { jobId, leaseToken: expect.any(String) },
    );
    expect(ia.submitJob).not.toHaveBeenCalled();
    expect(
      prisma.documentProcessingJob.updateMany.mock.calls.some(
        ([query]) => query.data.status === 'WAITING_FOR_WORKER',
      ),
    ).toBe(false);
  });

  it('does not consume remote work for an obsolete clinical version', async () => {
    prisma.documentProcessingJob.findMany.mockResolvedValue([
      { ...job(), document: { ...job().document, version: 5 } },
    ]);
    await service.tick();
    expect(ia.getJob).not.toHaveBeenCalled();
    expect(layouts.completeProcessing).not.toHaveBeenCalled();
    expect(prisma.documentProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'INTERRUPTED',
          error: expect.objectContaining({ code: 'DOCUMENT_CHANGED' }),
        }),
      }),
    );
  });

  it('serializes ticks in this instance and stops scheduling after shutdown', async () => {
    let release: (value: IaJobStatus) => void = () => undefined;
    ia.getJob.mockReturnValue(
      new Promise<IaJobStatus>((resolve) => {
        release = resolve;
      }),
    );
    const first = service.tick();
    await service.tick();
    expect(prisma.documentProcessingJob.findMany).toHaveBeenCalledTimes(1);
    release(remote());
    await first;
    service.onModuleDestroy();
    await service.tick();
    expect(prisma.documentProcessingJob.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns a prior claim for an identical submission and rejects stale versions', async () => {
    const doc = {
      ...job().document,
      processingJobs: [job()],
    } as unknown as MedicalDocumentWithAssignee;
    await expect(service.enqueue(doc, 'actor', 3)).resolves.toBe(doc);
    await expect(service.enqueue(doc, 'actor', 1)).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an oversized input before claiming the document', async () => {
    const doc = {
      ...job().document,
      status: DocumentStatus.PENDING,
      processingJobs: [],
    } as unknown as MedicalDocumentWithAssignee;
    storage.readFile.mockResolvedValue(Buffer.alloc(20 * 1024 * 1024 + 1));
    await expect(service.enqueue(doc, 'actor', 4)).rejects.toThrow(PayloadTooLargeException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stops retrying a permanent publication limit without rerunning or discarding remote OCR', async () => {
    const runId = randomUUID();
    ia.getJob.mockResolvedValue(remote({ status: 'SUCCEEDED', processingRunId: runId }));
    ia.getJobResult.mockResolvedValue({
      documentId: docId,
      processingRunId: runId,
      layout: { runId, pages: [] },
    });
    layouts.completeProcessing.mockRejectedValue(new OcrPublicationLimitError());
    await service.tick();
    expect(ia.submitJob).not.toHaveBeenCalled();
    expect(prisma.documentProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.objectContaining({ code: 'ARTIFACT_CACHE_LIMIT', retryable: false }),
        }),
      }),
    );
    expect(prisma.medicalDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: DocumentStatus.FAILED, version: { increment: 1 } },
      }),
    );
  });
});

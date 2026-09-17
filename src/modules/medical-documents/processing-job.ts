import { DocumentProcessingJob } from '@prisma/client';
import type { IaJobProgress } from '../../core/ia/ia-job.types';

export const ACTIVE_PROCESSING_STATES = ['QUEUED', 'RUNNING', 'WAITING_FOR_WORKER', 'FINALIZING'];
export const initialProgress = (): IaJobProgress => ({
  phase: 'QUEUED',
  currentPage: null,
  pagesTotal: null,
  pagesCompleted: 0,
  linesTotal: null,
  linesCompleted: 0,
  batchesTotal: null,
  batchesCompleted: 0,
});

export function processingSnapshot(job?: DocumentProcessingJob) {
  if (!job) return null;
  const error = job.error as { code: string; message: string; retryable: boolean } | null;
  return {
    jobId: job.id,
    attempt: job.attempt,
    status: job.status,
    progress: job.progress as unknown as IaJobProgress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    heartbeatAt: job.heartbeatAt,
    error,
    canRetry: ['FAILED', 'INTERRUPTED'].includes(job.status) && error?.retryable === true,
  };
}

export interface ProcessingFence {
  jobId: string;
  leaseToken: string;
}

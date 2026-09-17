import type { ProcessResult } from './ia-client.service';

export const IA_JOB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const IA_SOURCE_SHA256 = /^[0-9a-f]{64}$/;
export type IaJobState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
export type IaJobPhase =
  | 'QUEUED'
  | 'PREPARING'
  | 'SEGMENTING'
  | 'LOADING_MODEL'
  | 'RECOGNIZING'
  | 'EXTRACTING'
  | 'SAVING'
  | 'COMPLETE';
export interface IaJobProgress {
  phase: IaJobPhase;
  currentPage: number | null;
  pagesTotal: number | null;
  pagesCompleted: number;
  linesTotal: number | null;
  linesCompleted: number;
  batchesTotal: number | null;
  batchesCompleted: number;
}
export interface IaJobStatus {
  jobId: string;
  documentId: string;
  sourceSha256: string;
  status: IaJobState;
  attempt: 1;
  processingRunId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  progress: IaJobProgress;
  error: { code: string; message: string; retryable: boolean } | null;
}
export interface IaJobResult extends ProcessResult {
  documentId: string;
  processingRunId: string | null;
}

/** Transport status only: never retain the worker's potentially sensitive body. */
export class IaJobHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`IA job request failed with HTTP ${statusCode}.`);
    this.name = 'IaJobHttpError';
  }
}
export class IaJobProtocolError extends Error {
  constructor() {
    super('Invalid IA job response or request identity.');
    this.name = 'IaJobProtocolError';
  }
}

export function assertIaJobIdentity(
  status: IaJobStatus,
  documentId: string,
  sourceSha256: string,
): void {
  if (status.documentId !== documentId || status.sourceSha256 !== sourceSha256) {
    throw new IaJobProtocolError();
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IaJobProtocolError();
  return value as Record<string, unknown>;
}
function counter(value: unknown, max: number, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new IaJobProtocolError();
  }
  return value as number;
}
function timestamp(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new IaJobProtocolError();
  return value;
}

/** Reconstruct an allowlisted status instead of spreading untrusted job JSON. */
export function parseIaJobStatus(raw: unknown, expectedJobId: string): IaJobStatus {
  const data = object(raw);
  const progress = object(data.progress);
  const phases: IaJobPhase[] = [
    'QUEUED',
    'PREPARING',
    'SEGMENTING',
    'LOADING_MODEL',
    'RECOGNIZING',
    'EXTRACTING',
    'SAVING',
    'COMPLETE',
  ];
  const states: IaJobState[] = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED'];
  if (
    data.jobId !== expectedJobId ||
    !IA_JOB_UUID.test(expectedJobId) ||
    typeof data.documentId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(data.documentId) ||
    typeof data.sourceSha256 !== 'string' ||
    !IA_SOURCE_SHA256.test(data.sourceSha256) ||
    !states.includes(data.status as IaJobState) ||
    data.attempt !== 1 ||
    !phases.includes(progress.phase as IaJobPhase) ||
    (data.processingRunId !== null &&
      (typeof data.processingRunId !== 'string' || !IA_JOB_UUID.test(data.processingRunId)))
  )
    throw new IaJobProtocolError();

  const parsedProgress: IaJobProgress = {
    phase: progress.phase as IaJobPhase,
    currentPage: counter(progress.currentPage, 10000, true),
    pagesTotal: counter(progress.pagesTotal, 10000, true),
    pagesCompleted: counter(progress.pagesCompleted, 10000)!,
    linesTotal: counter(progress.linesTotal, 1000000, true),
    linesCompleted: counter(progress.linesCompleted, 1000000)!,
    batchesTotal: counter(progress.batchesTotal, 1000000, true),
    batchesCompleted: counter(progress.batchesCompleted, 1000000)!,
  };
  if (
    parsedProgress.currentPage === 0 ||
    (parsedProgress.pagesTotal !== null &&
      (parsedProgress.pagesCompleted > parsedProgress.pagesTotal ||
        (parsedProgress.currentPage !== null &&
          parsedProgress.currentPage > parsedProgress.pagesTotal))) ||
    (parsedProgress.linesTotal !== null &&
      parsedProgress.linesCompleted > parsedProgress.linesTotal) ||
    (parsedProgress.batchesTotal !== null &&
      parsedProgress.batchesCompleted > parsedProgress.batchesTotal)
  ) {
    throw new IaJobProtocolError();
  }
  let error: IaJobStatus['error'] = null;
  if (data.error !== null) {
    const source = object(data.error);
    if (
      typeof source.code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,79}$/.test(source.code) ||
      typeof source.retryable !== 'boolean' ||
      typeof source.message !== 'string'
    ) {
      throw new IaJobProtocolError();
    }
    error = {
      code: source.code,
      retryable: source.retryable,
      message:
        'El procesamiento de IA no pudo completarse. Consulta el estado y reintenta cuando corresponda.',
    };
  }
  const status: IaJobStatus = {
    jobId: expectedJobId,
    documentId: data.documentId,
    sourceSha256: data.sourceSha256,
    status: data.status as IaJobState,
    attempt: 1,
    processingRunId: data.processingRunId as string | null,
    createdAt: timestamp(data.createdAt)!,
    updatedAt: timestamp(data.updatedAt)!,
    startedAt: timestamp(data.startedAt, true),
    completedAt: timestamp(data.completedAt, true),
    heartbeatAt: timestamp(data.heartbeatAt, true),
    progress: parsedProgress,
    error,
  };
  const terminal = ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(status.status);
  if (
    terminal !== (status.completedAt !== null) ||
    (status.status === 'SUCCEEDED' && (status.progress.phase !== 'COMPLETE' || error !== null)) ||
    (['QUEUED', 'RUNNING'].includes(status.status) && error !== null) ||
    (['FAILED', 'INTERRUPTED'].includes(status.status) && error === null)
  )
    throw new IaJobProtocolError();
  return status;
}

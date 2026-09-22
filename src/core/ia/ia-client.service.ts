import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import { createHash } from 'node:crypto';
import { MachineOcrLayout, normalizeOcrLayout, OCR_IDENTIFIER } from './ocr-layout';
import {
  assertIaJobIdentity,
  IA_JOB_UUID,
  IA_SOURCE_SHA256,
  IaJobHttpError,
  IaJobProtocolError,
  IaJobResult,
  IaJobStatus,
  parseIaJobStatus,
} from './ia-job.types';

export interface ExtractedEntity {
  type: 'DIAGNOSIS' | 'SYMPTOM' | 'MEDICATION' | 'PROCEDURE' | 'CLINICAL_DATE' | 'OBSERVATION';
  value: string;
  normalizedValue?: string | null;
  sourceSpan?: { page: number; start: number; end: number } | null;
  confidence: number;
}

/**
 * Métricas de calidad OCR/NER del servicio IA v2 (normalizadas a camelCase).
 * estimated=true cuando el worker no tuvo texto de referencia y los valores
 * derivan de la confianza del modelo.
 */
export interface OcrMetrics {
  cer: number | null;
  wer: number | null;
  charAccuracy: number | null;
  nerPrecision: number | null;
  nerRecall: number | null;
  nerF1: number | null;
  estimated: boolean;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProcessResult {
  ocrText: string;
  entities: ExtractedEntity[];
  /** null cuando el worker (v1/Tesseract) no devuelve métricas. */
  metrics: OcrMetrics | null;
  ocrConfidence: number | null;
  confidenceLevel: ConfidenceLevel | null;
  /** Additive: absent for legacy workers. Never infer page geometry from flat OCR. */
  layout?: MachineOcrLayout | null;
}

/** Forma del campo metrics tal como lo emite el servicio IA v2 (snake_case). */
interface RawMetrics {
  cer?: number | null;
  wer?: number | null;
  char_accuracy?: number | null;
  ner_precision?: number | null;
  ner_recall?: number | null;
  ner_f1?: number | null;
  estimated?: boolean;
}

interface RawProcessResponse {
  documentId?: string;
  ocr: { text: string; pages?: unknown };
  processingRunId?: string | null;
  entities: ExtractedEntity[];
  metrics?: RawMetrics | null;
  confidence?: { overall?: number; level?: string } | null;
}

@Injectable()
export class IaClientService implements OnModuleDestroy {
  private readonly logger = new Logger(IaClientService.name);
  private readonly baseUrl: string;
  private readonly processAgent: Agent;
  private readonly processTimeoutMs: number;
  private readonly jobAgent: Agent;
  private readonly jobTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('ia.internalUrl', 'http://ia:8000');
    this.processTimeoutMs = this.configService.get<number>('ia.processTimeoutMs', 1800000);
    if (
      !Number.isSafeInteger(this.processTimeoutMs) ||
      this.processTimeoutMs <= 0 ||
      this.processTimeoutMs > 7200000
    ) {
      throw new Error('IA process timeout must be a positive, bounded duration.');
    }
    this.jobTimeoutMs = this.configService.get<number>('ia.jobTimeoutMs', 15000);
    if (
      !Number.isSafeInteger(this.jobTimeoutMs) ||
      this.jobTimeoutMs <= 0 ||
      this.jobTimeoutMs > 60000
    ) {
      throw new Error('IA job timeout must be a positive, bounded duration.');
    }
    // Independent short requests must not queue behind a legacy long OCR POST.
    this.jobAgent = new Agent({
      headersTimeout: this.jobTimeoutMs,
      bodyTimeout: this.jobTimeoutMs,
      connect: { timeout: Math.min(10000, this.jobTimeoutMs) },
      connections: 4,
      pipelining: 1,
      maxOrigins: 1,
      allowH2: false,
    });
    // A total AbortSignal does not replace Undici's independent 300 s defaults.
    // Keep a private dispatcher: other HTTP clients retain their own policies.
    this.processAgent = new Agent({
      headersTimeout: this.processTimeoutMs,
      bodyTimeout: this.processTimeoutMs,
      connect: { timeout: Math.min(10000, this.processTimeoutMs) },
      connections: 2,
      pipelining: 1,
      maxOrigins: 1,
      allowH2: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    // An application shutdown must release sockets, not wait up to 30 minutes.
    // Deliberately abort pending requests; never automatically retry an OCR POST.
    await Promise.all([this.processAgent.destroy(), this.jobAgent.destroy()]);
  }

  async process(
    documentId: string,
    fileBytes: Buffer,
    mimeType: 'image/jpeg' | 'image/png' | 'application/pdf',
  ): Promise<ProcessResult> {
    const fileRef = `data:${mimeType};base64,${fileBytes.toString('base64')}`;
    const body = JSON.stringify({
      documentId,
      fileRef,
      mimeType,
      options: { language: 'es', withEntities: true },
    });

    const endpoint = new URL(`${this.baseUrl.replace(/\/$/, '')}/v1/process`);
    const res = await this.processAgent.request({
      origin: endpoint.origin,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-IA-Internal-Key': this.internalApiKey() },
      body,
      headersTimeout: this.processTimeoutMs,
      bodyTimeout: this.processTimeoutMs,
      signal: AbortSignal.timeout(this.processTimeoutMs),
      idempotent: false,
    });

    // Agent.request has no redirect/retry interceptor: 3xx/5xx are not replayed.
    if (res.statusCode < 200 || res.statusCode >= 300) {
      // A worker error can contain source text or internal secrets. Never echo it.
      res.body.on('error', () => undefined);
      res.body.destroy();
      this.logger.warn(`IA worker respondio ${res.statusCode} para documento ${documentId}.`);
      throw new Error(`IA process failed with status ${res.statusCode}.`);
    }

    const data = (await res.body.json()) as RawProcessResponse;

    return this.normalizeProcessResult(data);
  }

  /** Same UUID + immutable source identity is the only safe submission replay. */
  async submitJob(
    jobId: string,
    documentId: string,
    sourceSha256: string,
    fileBytes: Buffer,
    mimeType: 'image/jpeg' | 'image/png' | 'application/pdf',
  ): Promise<IaJobStatus> {
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(documentId) ||
      !IA_SOURCE_SHA256.test(sourceSha256) ||
      !['image/jpeg', 'image/png', 'application/pdf'].includes(mimeType) ||
      fileBytes.length === 0 ||
      fileBytes.length > 20 * 1024 * 1024 ||
      createHash('sha256').update(fileBytes).digest('hex') !== sourceSha256
    ) {
      throw new IaJobProtocolError();
    }
    const raw = await this.requestJob(jobId, 'POST', false, {
      documentId,
      sourceSha256,
      mimeType,
      fileRef: `data:${mimeType};base64,${fileBytes.toString('base64')}`,
      options: { language: 'es', withEntities: true },
    });
    const status = parseIaJobStatus(raw, jobId);
    assertIaJobIdentity(status, documentId, sourceSha256);
    return status;
  }

  async getJob(jobId: string): Promise<IaJobStatus> {
    return parseIaJobStatus(await this.requestJob(jobId, 'GET', false), jobId);
  }

  async getJobResult(jobId: string): Promise<IaJobResult> {
    const raw = await this.requestJob(jobId, 'GET', true);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IaJobProtocolError();
    const data = raw as RawProcessResponse;
    if (
      typeof data.documentId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(data.documentId) ||
      (data.processingRunId !== null &&
        (typeof data.processingRunId !== 'string' || !IA_JOB_UUID.test(data.processingRunId))) ||
      !data.ocr ||
      typeof data.ocr.text !== 'string' ||
      data.ocr.text.length > 2000000 ||
      !Array.isArray(data.ocr.pages) ||
      data.ocr.pages.length > 1000 ||
      !Array.isArray(data.entities) ||
      data.entities.length > 20000
    )
      throw new IaJobProtocolError();
    const entityTypes = [
      'DIAGNOSIS',
      'SYMPTOM',
      'MEDICATION',
      'PROCEDURE',
      'CLINICAL_DATE',
      'OBSERVATION',
    ];
    for (const entity of data.entities) {
      if (
        !entity ||
        !entityTypes.includes(entity.type) ||
        typeof entity.value !== 'string' ||
        entity.value.length > 50000 ||
        !Number.isFinite(entity.confidence) ||
        entity.confidence < 0 ||
        entity.confidence > 1 ||
        (entity.normalizedValue != null && typeof entity.normalizedValue !== 'string')
      ) {
        throw new IaJobProtocolError();
      }
      const span = entity.sourceSpan;
      if (
        span != null &&
        (!Number.isSafeInteger(span.page) ||
          span.page < 1 ||
          !Number.isSafeInteger(span.start) ||
          span.start < 0 ||
          !Number.isSafeInteger(span.end) ||
          span.end < span.start)
      )
        throw new IaJobProtocolError();
    }
    if (
      !data.confidence ||
      !Number.isFinite(data.confidence.overall) ||
      data.confidence.overall! < 0 ||
      data.confidence.overall! > 1 ||
      !this.normalizeLevel(data.confidence.level)
    )
      throw new IaJobProtocolError();
    if (data.metrics != null) {
      if (
        typeof data.metrics !== 'object' ||
        Array.isArray(data.metrics) ||
        typeof data.metrics.estimated !== 'boolean'
      )
        throw new IaJobProtocolError();
      for (const key of [
        'cer',
        'wer',
        'char_accuracy',
        'ner_precision',
        'ner_recall',
        'ner_f1',
      ] as const) {
        if (data.metrics[key] != null && !Number.isFinite(data.metrics[key]))
          throw new IaJobProtocolError();
      }
    }
    const normalized = this.normalizeProcessResult(data);
    // A job declaring a spatial run must not silently downgrade malformed geometry
    // into the legacy flat-text path, which would lose its review provenance.
    if (data.processingRunId !== null && !normalized.layout) throw new IaJobProtocolError();
    return {
      ...normalized,
      documentId: data.documentId,
      processingRunId: data.processingRunId ?? null,
    };
  }

  private async requestJob(
    jobId: string,
    method: 'GET' | 'POST',
    result: boolean,
    payload?: object,
  ): Promise<unknown> {
    if (!IA_JOB_UUID.test(jobId) || (result && method !== 'GET')) throw new IaJobProtocolError();
    const key = this.internalApiKey();
    const endpoint = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/v1/jobs/${jobId}${result ? '/result' : ''}`,
    );
    const response = await this.jobAgent.request({
      origin: endpoint.origin,
      path: `${endpoint.pathname}${endpoint.search}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-IA-Internal-Key': key,
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      headersTimeout: this.jobTimeoutMs,
      bodyTimeout: this.jobTimeoutMs,
      signal: AbortSignal.timeout(this.jobTimeoutMs),
      idempotent: false,
    });
    // Destroying an unread Undici body emits AbortError. Register a listener
    // before rejecting headers/status; the async iterator still rejects reads.
    response.body.on('error', () => undefined);
    // No redirects, retries, or worker error-body logging (even for 404/409/429).
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.body.destroy();
      throw new IaJobHttpError(response.statusCode);
    }
    const contentType = response.headers['content-type'];
    const limit = result ? 16 * 1024 * 1024 : 64 * 1024;
    if (
      typeof contentType !== 'string' ||
      contentType.split(';')[0].trim() !== 'application/json' ||
      Number(response.headers['content-length']) > limit
    ) {
      response.body.destroy();
      throw new IaJobProtocolError();
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > limit) throw new IaJobProtocolError();
        chunks.push(buffer);
      }
    } catch (error) {
      response.body.destroy();
      throw error;
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new IaJobProtocolError();
    }
  }

  private internalApiKey(): string {
    const key = this.configService.get<string>('ia.internalApiKey');
    if (typeof key !== 'string' || key.length < 32)
      throw new Error('IA internal access is not configured.');
    return key;
  }

  private normalizeProcessResult(data: RawProcessResponse): ProcessResult {
    return {
      ocrText: data.ocr.text,
      entities: data.entities,
      metrics: this.normalizeMetrics(data.metrics),
      ocrConfidence: typeof data.confidence?.overall === 'number' ? data.confidence.overall : null,
      confidenceLevel: this.normalizeLevel(data.confidence?.level),
      layout: normalizeOcrLayout(data.processingRunId, data.ocr.pages),
    };
  }

  /** Internal-only fetch: no user supplied host/path, redirects or unbounded body. */
  async getPageImage(documentId: string, runId: string, page: number): Promise<Buffer> {
    if (
      !OCR_IDENTIFIER.test(documentId) ||
      !OCR_IDENTIFIER.test(runId) ||
      !Number.isInteger(page) ||
      page < 1
    )
      throw new Error('Invalid OCR artifact identifier.');
    const key = this.configService.get<string>('ia.internalApiKey');
    if (!key) throw new Error('IA internal artifact access is not configured.');
    const response = await fetch(
      `${this.baseUrl}/v1/artifacts/${encodeURIComponent(documentId)}/${encodeURIComponent(runId)}/pages/${page}/image`,
      {
        headers: { 'X-IA-Internal-Key': key },
        redirect: 'error',
        signal: AbortSignal.timeout(this.configService.get<number>('ia.imageTimeoutMs', 30000)),
      },
    );
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png') {
      await response.body?.cancel();
      throw new Error(`OCR page image unavailable (${response.status}).`);
    }
    const maxBytes = this.configService.get<number>('ia.maxPageImageBytes', 26214400);
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new Error('OCR page image exceeds the allowed size.');
    }
    if (!response.body) throw new Error('OCR page image is empty.');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error('OCR page image exceeds the allowed size.');
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const buffer = Buffer.concat(chunks);
    if (
      buffer.length < 24 ||
      !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      throw new Error('OCR page image is not a PNG.');
    }
    return buffer;
  }

  private normalizeMetrics(raw: RawMetrics | null | undefined): OcrMetrics | null {
    if (!raw) return null;
    return {
      cer: raw.cer ?? null,
      wer: raw.wer ?? null,
      charAccuracy: raw.char_accuracy ?? null,
      nerPrecision: raw.ner_precision ?? null,
      nerRecall: raw.ner_recall ?? null,
      nerF1: raw.ner_f1 ?? null,
      estimated: raw.estimated ?? true,
    };
  }

  private normalizeLevel(level: string | undefined): ConfidenceLevel | null {
    if (level === 'HIGH' || level === 'MEDIUM' || level === 'LOW') return level;
    return null;
  }
}

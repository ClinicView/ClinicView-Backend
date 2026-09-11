import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import { MachineOcrLayout, normalizeOcrLayout, OCR_IDENTIFIER } from './ocr-layout';

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
    await this.processAgent.destroy();
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
      headers: { 'Content-Type': 'application/json' },
      body,
      headersTimeout: this.processTimeoutMs,
      bodyTimeout: this.processTimeoutMs,
      signal: AbortSignal.timeout(this.processTimeoutMs),
      idempotent: false,
    });

    // Agent.request has no redirect/retry interceptor: 3xx/5xx are not replayed.
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const detail = await this.readErrorDetail(res.body);
      this.logger.warn(
        `IA worker respondio ${res.statusCode} para documento ${documentId}: ${detail}`,
      );
      throw new Error(`IA process failed with status ${res.statusCode}: ${detail}`);
    }

    const data = (await res.body.json()) as RawProcessResponse;

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

  private async readErrorDetail(res: { text(): Promise<string> }): Promise<string> {
    const fallback = 'Error no especificado por el worker IA.';

    try {
      const raw = await res.text();
      if (!raw.trim()) return fallback;

      const parsed = JSON.parse(raw) as { detail?: unknown };
      return typeof parsed.detail === 'string' && parsed.detail.trim()
        ? parsed.detail
        : raw.slice(0, 500);
    } catch {
      return fallback;
    }
  }
}

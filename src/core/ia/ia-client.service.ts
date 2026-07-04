import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  ocr: { text: string };
  entities: ExtractedEntity[];
  metrics?: RawMetrics | null;
  confidence?: { overall?: number; level?: string } | null;
}

@Injectable()
export class IaClientService {
  private readonly logger = new Logger(IaClientService.name);
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('ia.internalUrl', 'http://ia:8000');
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

    const res = await fetch(`${this.baseUrl}/v1/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const detail = await this.readErrorDetail(res);
      this.logger.warn(
        `IA worker respondio ${res.status} para documento ${documentId}: ${detail}`,
      );
      throw new Error(`IA process failed with status ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as RawProcessResponse;

    return {
      ocrText: data.ocr.text,
      entities: data.entities,
      metrics: this.normalizeMetrics(data.metrics),
      ocrConfidence: typeof data.confidence?.overall === 'number' ? data.confidence.overall : null,
      confidenceLevel: this.normalizeLevel(data.confidence?.level),
    };
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

  private async readErrorDetail(res: Response): Promise<string> {
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

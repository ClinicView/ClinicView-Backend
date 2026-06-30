import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ExtractedEntity {
  type: 'DIAGNOSIS' | 'SYMPTOM' | 'MEDICATION' | 'PROCEDURE' | 'CLINICAL_DATE' | 'OBSERVATION';
  value: string;
  normalizedValue?: string | null;
  sourceSpan?: { page: number; start: number; end: number } | null;
  confidence: number;
}

export interface ProcessResult {
  ocrText: string;
  entities: ExtractedEntity[];
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

    const data = (await res.json()) as {
      ocr: { text: string };
      entities: ExtractedEntity[];
    };

    return { ocrText: data.ocr.text, entities: data.entities };
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

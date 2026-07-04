import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentStatus } from '@prisma/client';

export class DocumentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() patientId: string;
  @ApiProperty() originalName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) ocrText: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['DIAGNOSIS', 'SYMPTOM', 'MEDICATION', 'PROCEDURE', 'CLINICAL_DATE', 'OBSERVATION'] },
        value: { type: 'string' },
        normalizedValue: { type: 'string', nullable: true },
        sourceSpan: {
          type: 'object',
          nullable: true,
          properties: {
            page: { type: 'number' },
            start: { type: 'number' },
            end: { type: 'number' },
          },
        },
        confidence: { type: 'number' },
      },
    },
  })
  nerEntities: unknown;
  @ApiPropertyOptional({ type: String, nullable: true }) correctedText: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['DIAGNOSIS', 'SYMPTOM', 'MEDICATION', 'PROCEDURE', 'CLINICAL_DATE', 'OBSERVATION'] },
        value: { type: 'string' },
        normalizedValue: { type: 'string', nullable: true },
      },
    },
  })
  correctedEntities: unknown;
  @ApiPropertyOptional({ type: String, nullable: true }) correctedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) correctedById: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectReason: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    description: 'Métricas de calidad OCR/NER del servicio IA v2',
    properties: {
      cer: { type: 'number', nullable: true },
      wer: { type: 'number', nullable: true },
      charAccuracy: { type: 'number', nullable: true },
      nerPrecision: { type: 'number', nullable: true },
      nerRecall: { type: 'number', nullable: true },
      nerF1: { type: 'number', nullable: true },
      estimated: { type: 'boolean' },
    },
  })
  metrics: unknown;
  @ApiPropertyOptional({ type: Number, nullable: true }) ocrConfidence: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, enum: ['HIGH', 'MEDIUM', 'LOW'] })
  confidenceLevel: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) processedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewedAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewedBy: string | null;
  @ApiProperty() updatedAt: Date;
}

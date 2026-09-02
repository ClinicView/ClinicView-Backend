import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DocumentStatus,
  DocumentType,
  RecordOrigin,
  RecordStatus,
  RecordType,
  Sex,
} from '@prisma/client';

export class ClinicalHistoryExportPatientDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: DocumentType }) documentType: DocumentType;
  @ApiProperty() documentNumber: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ type: String, format: 'date', example: '1985-06-15' })
  dateOfBirth: string;
  @ApiProperty({ enum: Sex }) sex: Sex;
  @ApiPropertyOptional({ type: String, nullable: true }) phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) address: string | null;
}

export class ClinicalHistoryExportRecordDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: RecordType }) recordType: RecordType;
  @ApiProperty({ enum: RecordOrigin }) origin: RecordOrigin;
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiProperty() attendedAt: Date;
  @ApiProperty() summary: string;
  @ApiPropertyOptional({ type: String, nullable: true }) notes: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) doctorName: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) service: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) preliminaryDiagnosis: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) plan: string | null;
  @ApiProperty({ enum: ['URGENT', 'PRIORITY', 'NORMAL', 'ELECTIVE'] }) priority: string;
  @ApiPropertyOptional({ type: String, nullable: true }) parentRecordId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) voidReason: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ClinicalHistoryExportDocumentDto {
  @ApiProperty() id: string;
  @ApiProperty() originalName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Texto clínico consolidado. Solo se expone cuando el documento fue validado.',
  })
  clinicalText: string | null;
  @ApiProperty({ enum: ['CORRECTED', 'OCR', 'NONE'] })
  textSource: 'CORRECTED' | 'OCR' | 'NONE';
  @ApiPropertyOptional({ type: String, nullable: true }) rejectReason: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true }) processedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) correctedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) reviewedAt: Date | null;
}

export class ClinicalHistoryExportResponseDto {
  @ApiProperty({ type: ClinicalHistoryExportPatientDto })
  patient: ClinicalHistoryExportPatientDto;

  @ApiProperty({ type: [ClinicalHistoryExportRecordDto] })
  records: ClinicalHistoryExportRecordDto[];

  @ApiProperty({ type: [ClinicalHistoryExportDocumentDto] })
  documents: ClinicalHistoryExportDocumentDto[];

  @ApiProperty({
    description:
      'Instante del servidor en que se generó la instantánea para la exportación.',
  })
  generatedAt: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecordOrigin, RecordStatus, RecordType } from '@prisma/client';
import { ClinicalRecordAttachmentResponseDto } from './record-attachment.dto';

export class RecordResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() patientId: string;
  @ApiProperty({ enum: RecordType }) recordType: RecordType;
  @ApiProperty({ enum: RecordOrigin }) origin: RecordOrigin;
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiProperty() attendedAt: Date;
  @ApiProperty() summary: string;
  @ApiPropertyOptional({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: Object, description: 'Contenido tipado según recordType y schemaVersion.' })
  details: Record<string, unknown>;
  @ApiProperty({ minimum: 1 }) schemaVersion: number;
  @ApiPropertyOptional({ type: String, nullable: true }) doctorName: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) professionalId:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) professionalNameSnapshot: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) professionalLicenseSnapshot: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) service: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) preliminaryDiagnosis: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) plan: string | null;
  @ApiProperty({ enum: ['URGENT', 'PRIORITY', 'NORMAL', 'ELECTIVE'] }) priority: string;
  @ApiPropertyOptional({ type: String, nullable: true }) parentRecordId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) voidReason: string | null;
  @ApiProperty() correctionsCount: number;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) createdBy: string | null;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ minimum: 0 }) version: number;
  @ApiProperty({ type: [ClinicalRecordAttachmentResponseDto] })
  attachments: ClinicalRecordAttachmentResponseDto[];
}

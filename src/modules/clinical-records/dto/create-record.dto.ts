import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { RecordType } from '@prisma/client';
import { IsPastOrPresentZonedIsoDateTime } from '../../../common/validation/clinical-date';
import {
  CLINICAL_DETAILS_ONE_OF,
  CLINICAL_RECORD_SCHEMA_VERSION,
  ClinicalDetailsApiModels,
  IsClinicalRecordDetails,
} from './record-details.dto';
import { RecordAttachmentInputDto, RecordAttachmentsValidation } from './record-attachment.dto';

export const RECORD_PRIORITIES = ['URGENT', 'PRIORITY', 'NORMAL', 'ELECTIVE'] as const;
export type RecordPriority = (typeof RECORD_PRIORITIES)[number];

@ClinicalDetailsApiModels()
export class CreateRecordDto {
  @ApiProperty({ enum: RecordType })
  @IsEnum(RecordType)
  recordType: RecordType;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha y hora de la atención como instante ISO 8601 con zona horaria',
    example: '2026-09-02T09:30:00-05:00',
  })
  @IsPastOrPresentZonedIsoDateTime()
  attendedAt: string;

  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Usuario profesional seleccionado; el servidor conserva una instantánea de identidad.',
  })
  @IsOptional()
  @IsUUID()
  professionalId?: string;

  @ApiPropertyOptional({
    maxLength: 80,
    description: 'Colegiatura consignada para la instantánea del registro.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  professionalLicense?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Médico o profesional responsable' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  doctorName?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Servicio o especialidad' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  service?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preliminaryDiagnosis?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Indicaciones / plan de manejo' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plan?: string;

  @ApiPropertyOptional({ enum: RECORD_PRIORITIES, default: 'NORMAL' })
  @IsOptional()
  @IsIn(RECORD_PRIORITIES)
  priority?: RecordPriority;

  @ApiPropertyOptional({ enum: [CLINICAL_RECORD_SCHEMA_VERSION], default: 1 })
  @IsOptional()
  @IsInt()
  @IsIn([CLINICAL_RECORD_SCHEMA_VERSION])
  schemaVersion?: typeof CLINICAL_RECORD_SCHEMA_VERSION;

  @ApiProperty({ ...CLINICAL_DETAILS_ONE_OF })
  @IsDefined()
  @IsObject()
  @IsClinicalRecordDetails()
  details: Record<string, unknown>;

  @ApiPropertyOptional({ type: [RecordAttachmentInputDto], maxItems: 10, default: [] })
  @RecordAttachmentsValidation()
  attachments?: RecordAttachmentInputDto[];

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Borrador del actor que se consumirá atómicamente al crear el registro.',
  })
  @IsOptional()
  @IsUUID()
  draftId?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Versión observada del borrador. Es obligatoria cuando se envía draftId y se consume mediante CAS.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedDraftVersion?: number;
}

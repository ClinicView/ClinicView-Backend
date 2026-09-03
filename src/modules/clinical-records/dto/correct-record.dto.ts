import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
  ValidateIf,
} from 'class-validator';
import { RecordType } from '@prisma/client';
import { IsPastOrPresentZonedIsoDateTime } from '../../../common/validation/clinical-date';
import { RECORD_PRIORITIES, type RecordPriority } from './create-record.dto';
import {
  CLINICAL_DETAILS_ONE_OF,
  CLINICAL_RECORD_SCHEMA_VERSION,
  ClinicalDetailsApiModels,
} from './record-details.dto';
import { RecordAttachmentInputDto, RecordAttachmentsValidation } from './record-attachment.dto';

@ClinicalDetailsApiModels()
export class CorrectRecordDto {
  @ApiProperty({ minimum: 0, description: 'Versión vigente del registro que se corrige.' })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiPropertyOptional({ enum: RecordType })
  @IsOptional()
  @IsEnum(RecordType)
  recordType?: RecordType;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Nuevo instante ISO 8601 con zona horaria; hereda el original si se omite',
    example: '2026-09-02T09:30:00-05:00',
  })
  @IsOptional()
  @IsPastOrPresentZonedIsoDateTime()
  attendedAt?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  professionalId?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  doctorName?: string | null;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  professionalLicense?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  service?: string | null;

  @ApiPropertyOptional({ maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preliminaryDiagnosis?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plan?: string | null;

  @ApiPropertyOptional({ enum: RECORD_PRIORITIES })
  @IsOptional()
  @IsIn(RECORD_PRIORITIES)
  priority?: RecordPriority;

  @ApiPropertyOptional({ enum: [CLINICAL_RECORD_SCHEMA_VERSION] })
  @IsOptional()
  @IsInt()
  @IsIn([CLINICAL_RECORD_SCHEMA_VERSION])
  schemaVersion?: typeof CLINICAL_RECORD_SCHEMA_VERSION;

  @ApiPropertyOptional({ ...CLINICAL_DETAILS_ONE_OF })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [RecordAttachmentInputDto],
    maxItems: 10,
    description: 'Si se omite, hereda los adjuntos del registro original.',
  })
  @RecordAttachmentsValidation()
  attachments?: RecordAttachmentInputDto[];
}

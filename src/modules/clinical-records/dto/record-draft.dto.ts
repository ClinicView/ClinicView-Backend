import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { RecordType } from '@prisma/client';
import { IsPastOrPresentZonedIsoDateTime } from '../../../common/validation/clinical-date';
import { RECORD_PRIORITIES, type RecordPriority } from './create-record.dto';
import {
  CLINICAL_DETAILS_ONE_OF,
  CLINICAL_RECORD_SCHEMA_VERSION,
  ClinicalDetailsApiModels,
  IsClinicalRecordDetails,
} from './record-details.dto';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

@ClinicalDetailsApiModels()
export class RecordDraftPayloadDto {
  @ApiPropertyOptional({ enum: RecordType })
  @IsOptional()
  @IsEnum(RecordType)
  recordType?: RecordType;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsPastOrPresentZonedIsoDateTime()
  attendedAt?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  professionalId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  doctorName?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(80)
  professionalLicense?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  service?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(300)
  preliminaryDiagnosis?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  plan?: string;

  @ApiPropertyOptional({ enum: RECORD_PRIORITIES })
  @IsOptional()
  @IsIn(RECORD_PRIORITIES)
  priority?: RecordPriority;

  @ApiPropertyOptional({ enum: [CLINICAL_RECORD_SCHEMA_VERSION], default: 1 })
  @IsOptional()
  @IsInt()
  @IsIn([CLINICAL_RECORD_SCHEMA_VERSION])
  schemaVersion?: typeof CLINICAL_RECORD_SCHEMA_VERSION;

  @ApiPropertyOptional({ ...CLINICAL_DETAILS_ONE_OF })
  @IsOptional()
  @IsObject()
  @IsClinicalRecordDetails({ partial: true })
  details?: Record<string, unknown>;
}

export class UpsertRecordDraftDto {
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Obligatorio al actualizar un borrador existente; debe coincidir con su versión.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @ApiProperty({ type: RecordDraftPayloadDto })
  @IsObject()
  @ValidateNested()
  @Type(() => RecordDraftPayloadDto)
  payload: RecordDraftPayloadDto;
}

export class DeleteRecordDraftQueryDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

export class RecordDraftResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'uuid' }) patientId: string;
  @ApiProperty({ type: Object }) payload: Record<string, unknown>;
  @ApiProperty({ minimum: 0 }) version: number;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

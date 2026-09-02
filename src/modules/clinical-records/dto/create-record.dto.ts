import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RecordOrigin, RecordType } from '@prisma/client';
import { IsPastOrPresentZonedIsoDateTime } from '../../../common/validation/clinical-date';

export const RECORD_PRIORITIES = ['URGENT', 'PRIORITY', 'NORMAL', 'ELECTIVE'] as const;
export type RecordPriority = (typeof RECORD_PRIORITIES)[number];

export class CreateRecordDto {
  @ApiProperty({ enum: RecordType })
  @IsEnum(RecordType)
  recordType: RecordType;

  @ApiPropertyOptional({ enum: RecordOrigin, default: RecordOrigin.MANUAL })
  @IsOptional()
  @IsEnum(RecordOrigin)
  origin?: RecordOrigin;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha y hora de la atención como instante ISO 8601 con zona horaria',
    example: '2026-09-02T09:30:00-05:00',
  })
  @IsPastOrPresentZonedIsoDateTime()
  attendedAt: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

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
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { RecordOrigin, RecordStatus, RecordType } from '@prisma/client';
import { IsClinicalDateFilter } from '../../../common/validation/clinical-date';

export class FindRecordsQueryDto {
  @ApiPropertyOptional({ enum: RecordType })
  @IsOptional()
  @IsEnum(RecordType)
  recordType?: RecordType;

  @ApiPropertyOptional({ enum: RecordStatus, default: RecordStatus.ACTIVE })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @ApiPropertyOptional({ enum: RecordOrigin })
  @IsOptional()
  @IsEnum(RecordOrigin)
  origin?: RecordOrigin;

  @ApiPropertyOptional({
    description:
      'Desde, inclusivo: YYYY-MM-DD (inicio del día en America/Lima) o ISO 8601 con zona',
    examples: ['2026-09-02', '2026-09-02T09:30:00-05:00'],
  })
  @IsOptional()
  @IsClinicalDateFilter()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Hasta: YYYY-MM-DD incluye todo el día en America/Lima; un ISO 8601 con zona es inclusivo',
    examples: ['2026-09-02', '2026-09-02T18:00:00-05:00'],
  })
  @IsOptional()
  @IsClinicalDateFilter()
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

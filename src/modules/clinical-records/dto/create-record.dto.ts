import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RecordOrigin, RecordType } from '@prisma/client';

export class CreateRecordDto {
  @ApiProperty({ enum: RecordType })
  @IsEnum(RecordType)
  recordType: RecordType;

  @ApiPropertyOptional({ enum: RecordOrigin, default: RecordOrigin.MANUAL })
  @IsOptional()
  @IsEnum(RecordOrigin)
  origin?: RecordOrigin;

  @ApiProperty({ description: 'Fecha y hora de la atención (ISO 8601)' })
  @IsISO8601()
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
}

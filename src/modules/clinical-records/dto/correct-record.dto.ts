import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsPastOrPresentZonedIsoDateTime } from '../../../common/validation/clinical-date';

export class CorrectRecordDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Nuevo instante ISO 8601 con zona horaria; hereda el original si se omite',
    example: '2026-09-02T09:30:00-05:00',
  })
  @IsOptional()
  @IsPastOrPresentZonedIsoDateTime()
  attendedAt?: string;

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

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CorrectRecordDto {
  @ApiPropertyOptional({
    description: 'Nuevo instante ISO 8601 con zona horaria; hereda el original si se omite',
    example: '2026-09-02T09:30:00-05:00',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/, {
    message: 'attendedAt debe incluir una zona horaria explícita (Z o ±HH:MM).',
  })
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

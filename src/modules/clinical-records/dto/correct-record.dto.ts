import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CorrectRecordDto {
  @ApiPropertyOptional({ description: 'Nueva fecha de atención (hereda la original si se omite)' })
  @IsOptional()
  @IsISO8601()
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

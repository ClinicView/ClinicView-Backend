import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CORRECTED_ENTITY_TYPES = [
  'DIAGNOSIS',
  'SYMPTOM',
  'MEDICATION',
  'PROCEDURE',
  'CLINICAL_DATE',
  'OBSERVATION',
] as const;

export class CorrectedEntityDto {
  @ApiPropertyOptional({ enum: ['DIAGNOSIS', 'SYMPTOM', 'MEDICATION', 'PROCEDURE', 'CLINICAL_DATE', 'OBSERVATION'] })
  @IsString()
  @IsIn(CORRECTED_ENTITY_TYPES)
  type: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  value: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  normalizedValue?: string | null;
}

export class CorrectDocumentDto {
  @ApiProperty({
    description: 'Versión leída por el cliente. Evita sobrescribir cambios de otro revisor.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiPropertyOptional({
    description: 'Texto corregido por el revisor. No sobrescribe el OCR original.',
    maxLength: 50000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  correctedText?: string;

  @ApiPropertyOptional({ type: () => [CorrectedEntityDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CorrectedEntityDto)
  correctedEntities?: CorrectedEntityDto[];
}

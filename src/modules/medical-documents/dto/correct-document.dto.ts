import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CorrectedEntityDto {
  @ApiPropertyOptional({ enum: ['DIAGNOSIS', 'SYMPTOM', 'MEDICATION', 'PROCEDURE', 'CLINICAL_DATE', 'OBSERVATION'] })
  @IsString()
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

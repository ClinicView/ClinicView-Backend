import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CorrectedEntityDto } from './correct-document.dto';

export const REQUIRED_VALIDATION_CHECKLIST = [
  'text',
  'entities',
  'sections',
  'phi',
] as const;

export class ValidateDocumentDto {
  @ApiProperty({
    description: 'Versión leída por el cliente. La validación falla con 409 si cambió.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({
    description: 'Texto final revisado. Se guarda junto con la validación sin sobrescribir el OCR.',
    maxLength: 50000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  correctedText: string;

  @ApiProperty({ type: () => [CorrectedEntityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CorrectedEntityDto)
  correctedEntities: CorrectedEntityDto[];

  @ApiProperty({
    enum: REQUIRED_VALIDATION_CHECKLIST,
    isArray: true,
    description: 'Confirmaciones clínicas aceptadas por el revisor.',
  })
  @IsArray()
  @ArrayMinSize(REQUIRED_VALIDATION_CHECKLIST.length)
  @ArrayMaxSize(REQUIRED_VALIDATION_CHECKLIST.length)
  @ArrayUnique()
  @IsIn(REQUIRED_VALIDATION_CHECKLIST, { each: true })
  checklistItems: string[];

  @ApiProperty({
    example: true,
    description: 'Atestación explícita de que el revisor verificó todos los puntos.',
  })
  @Equals(true)
  attested: true;
}

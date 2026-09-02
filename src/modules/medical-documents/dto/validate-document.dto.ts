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

export const VALIDATION_CHECKLIST_SCHEMA_VERSION = 1;

export const VALIDATION_CHECKLIST_DEFINITIONS = [
  {
    id: 'text',
    title: 'Texto corregido y revisado',
    statement: 'Todas las secciones fueron contrastadas con el documento original.',
  },
  {
    id: 'entities',
    title: 'Entidades clínicas verificadas',
    statement: 'Diagnósticos, medicamentos y fechas coinciden con la historia.',
  },
  {
    id: 'sections',
    title: 'Secciones completas',
    statement: 'Identificación, antecedentes, anamnesis y examen físico registrados.',
  },
  {
    id: 'phi',
    title: 'Datos del paciente correctos',
    statement: 'La identificación corresponde al paciente de la ficha.',
  },
] as const;

export const REQUIRED_VALIDATION_CHECKLIST = VALIDATION_CHECKLIST_DEFINITIONS.map(
  (item) => item.id,
);

export interface ValidationChecklistSnapshot {
  schemaVersion: number;
  locale: 'es-PE';
  items: Array<{
    id: string;
    title: string;
    statement: string;
  }>;
}

export function createValidationChecklistSnapshot(): ValidationChecklistSnapshot {
  return {
    schemaVersion: VALIDATION_CHECKLIST_SCHEMA_VERSION,
    locale: 'es-PE',
    items: VALIDATION_CHECKLIST_DEFINITIONS.map((item) => ({ ...item })),
  };
}

export class ValidationChecklistSnapshotItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() statement: string;
}

export class ValidationChecklistSnapshotDto {
  @ApiProperty({ example: VALIDATION_CHECKLIST_SCHEMA_VERSION }) schemaVersion: number;
  @ApiProperty({ example: 'es-PE' }) locale: string;
  @ApiProperty({ type: [ValidationChecklistSnapshotItemDto] })
  items: ValidationChecklistSnapshotItemDto[];
}

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
    description:
      'Identificadores de las confirmaciones clínicas aceptadas por el revisor. El servidor conserva una copia versionada de sus textos.',
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

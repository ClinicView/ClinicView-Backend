import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { IsPastOrPresentClinicalDate } from '../../../common/validation/clinical-date';

export enum ClinicalDocumentKind {
  CLINICAL_HISTORY = 'CLINICAL_HISTORY',
  CONSULTATION = 'CONSULTATION',
  EVOLUTION = 'EVOLUTION',
  LAB_RESULT = 'LAB_RESULT',
  PRESCRIPTION = 'PRESCRIPTION',
  PROCEDURE = 'PROCEDURE',
  THERAPY_NOTE = 'THERAPY_NOTE',
  IMAGING = 'IMAGING',
  DISCHARGE = 'DISCHARGE',
  REFERRAL = 'REFERRAL',
  OTHER = 'OTHER',
}

export class DocumentClinicalMetadataDto {
  @ApiPropertyOptional({ enum: ClinicalDocumentKind })
  @IsOptional()
  @IsEnum(ClinicalDocumentKind)
  documentKind?: ClinicalDocumentKind;

  @ApiPropertyOptional({
    format: 'date',
    description: 'Fecha civil de la atención o inicio del período; no es la fecha de carga.',
  })
  @IsOptional()
  @IsPastOrPresentClinicalDate()
  clinicalDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsPastOrPresentClinicalDate()
  clinicalEndDate?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceInstitution?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  sourceService?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  originalProfessional?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5000,
    description: 'Número de páginas declarado y comprobado visualmente; no se calcula por OCR.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  pageCount?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  sourceNotes?: string;
}

export class UpdateDocumentMetadataDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({ type: DocumentClinicalMetadataDto })
  @IsObject()
  @ValidateNested()
  @Type(() => DocumentClinicalMetadataDto)
  metadata: DocumentClinicalMetadataDto;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class DocumentMetadataRevisionDto {
  @ApiProperty() version: number;
  @ApiProperty({ type: DocumentClinicalMetadataDto }) metadata: DocumentClinicalMetadataDto;
  @ApiProperty() reason: string;
  @ApiPropertyOptional({ type: String, nullable: true }) recordedByName: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) recordedBy: string | null;
  @ApiProperty() createdAt: Date;
}

export function normalizeDocumentMetadata(
  metadata: DocumentClinicalMetadataDto,
): DocumentClinicalMetadataDto {
  if (
    metadata.clinicalEndDate &&
    (!metadata.clinicalDate || metadata.clinicalEndDate < metadata.clinicalDate)
  ) {
    throw new BadRequestException(
      'La fecha final requiere una fecha inicial y no puede ser anterior.',
    );
  }
  return Object.fromEntries(
    Object.entries(metadata)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      .filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

export class DocumentMetadataUpdateResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: DocumentClinicalMetadataDto }) clinicalMetadata: DocumentClinicalMetadataDto;
}

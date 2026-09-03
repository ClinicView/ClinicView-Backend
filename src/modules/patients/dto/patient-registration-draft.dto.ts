import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentType, Sex } from '@prisma/client';
import { IsPastOrPresentClinicalDate } from '../../../common/validation/clinical-date';

const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

export class PatientRegistrationDraftPayloadDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  documentNumber?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsPastOrPresentClinicalDate()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Sex })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(Sex)
  sex?: Sex;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}

export class UpsertPatientRegistrationDraftDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Identidad del borrador al actualizar. Se omite al crearlo.',
  })
  @IsOptional()
  @IsUUID()
  expectedId?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Versión observada del borrador. Se omite al crearlo.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @ApiProperty({ type: PatientRegistrationDraftPayloadDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PatientRegistrationDraftPayloadDto)
  payload: PatientRegistrationDraftPayloadDto;
}

export class DeletePatientRegistrationDraftQueryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  draftId: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

export class PatientRegistrationDraftResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: PatientRegistrationDraftPayloadDto })
  payload: PatientRegistrationDraftPayloadDto;

  @ApiProperty({ minimum: 0 })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

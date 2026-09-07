import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsPastOrPresentClinicalDate } from '../../../common/validation/clinical-date';

export enum ReconciliationStatus {
  UNKNOWN = 'UNKNOWN',
  NONE_KNOWN = 'NONE_KNOWN',
  RECORDED = 'RECORDED',
}
export enum AllergySeverity {
  UNKNOWN = 'UNKNOWN',
  MILD = 'MILD',
  MODERATE = 'MODERATE',
  SEVERE = 'SEVERE',
}
export enum ProblemStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
}
export enum MedicationStatus {
  ACTIVE = 'ACTIVE',
  STOPPED = 'STOPPED',
}

export class SummaryEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AllergyEntryDto extends SummaryEntryDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reaction: string;

  @ApiProperty({ enum: AllergySeverity })
  @IsEnum(AllergySeverity)
  severity: AllergySeverity;
}

export class ProblemEntryDto extends SummaryEntryDto {
  @ApiProperty({ enum: ProblemStatus })
  @IsEnum(ProblemStatus)
  status: ProblemStatus;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsPastOrPresentClinicalDate()
  onsetDate?: string;
}

export class MedicationEntryDto extends SummaryEntryDto {
  @ApiProperty({ enum: MedicationStatus })
  @IsEnum(MedicationStatus)
  status: MedicationStatus;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  regimen: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  indication?: string;
}

export class ClinicalSummaryPayloadDto {
  @ApiProperty({ enum: ReconciliationStatus })
  @IsEnum(ReconciliationStatus)
  allergyStatus: ReconciliationStatus;

  @ApiProperty({ type: [AllergyEntryDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AllergyEntryDto)
  allergies: AllergyEntryDto[];

  @ApiProperty({ enum: ReconciliationStatus })
  @IsEnum(ReconciliationStatus)
  problemStatus: ReconciliationStatus;

  @ApiProperty({ type: [ProblemEntryDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProblemEntryDto)
  problems: ProblemEntryDto[];

  @ApiProperty({ enum: ReconciliationStatus })
  @IsEnum(ReconciliationStatus)
  medicationStatus: ReconciliationStatus;

  @ApiProperty({ type: [MedicationEntryDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MedicationEntryDto)
  medications: MedicationEntryDto[];
}

export class SaveClinicalSummaryDto extends ClinicalSummaryPayloadDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ClinicalSummaryResponseDto {
  @ApiProperty() version: number;
  @ApiProperty({ type: ClinicalSummaryPayloadDto }) payload: ClinicalSummaryPayloadDto;
  @ApiProperty({ nullable: true, type: String }) recordedByName: string | null;
  @ApiProperty({ nullable: true, type: String }) recordedBy: string | null;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: Date }) createdAt: Date | null;
}

export const EMPTY_CLINICAL_SUMMARY: ClinicalSummaryPayloadDto = {
  allergyStatus: ReconciliationStatus.UNKNOWN,
  allergies: [],
  problemStatus: ReconciliationStatus.UNKNOWN,
  problems: [],
  medicationStatus: ReconciliationStatus.UNKNOWN,
  medications: [],
};

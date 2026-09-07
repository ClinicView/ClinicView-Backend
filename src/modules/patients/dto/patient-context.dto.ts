import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatientContextDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  medicalRecordNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  emergencyContactRelationship?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  representativeName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  insuranceName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  insuranceNumber?: string | null;
}

export const PATIENT_CONTEXT_FIELDS = [
  'medicalRecordNumber',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelationship',
  'representativeName',
  'insuranceName',
  'insuranceNumber',
] as const;

export function normalizePatientContext(dto: PatientContextDto): PatientContextDto {
  return Object.fromEntries(
    PATIENT_CONTEXT_FIELDS.filter((field) => dto[field] !== undefined).map((field) => [
      field,
      dto[field]?.trim() || null,
    ]),
  );
}

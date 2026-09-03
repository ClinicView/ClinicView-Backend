import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  validateSync,
  ValidateNested,
  type ValidationArguments,
  type ValidationError,
  type ValidationOptions,
} from 'class-validator';
import { Prisma, RecordType } from '@prisma/client';
import {
  isValidDateOnly,
  IsPastOrPresentZonedIsoDateTime,
  IsZonedIsoDateTime,
} from '../../../common/validation/clinical-date';

export const CLINICAL_RECORD_SCHEMA_VERSION = 1 as const;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

function RequiredClinicalText(maxLength: number): PropertyDecorator {
  return applyDecorators(Transform(trim), IsString(), MinLength(1), MaxLength(maxLength));
}

function OptionalClinicalText(maxLength: number): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Transform(trim),
    IsString(),
    MinLength(1),
    MaxLength(maxLength),
  );
}

function IsDateOnly(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isValidDateOnly(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} debe usar exactamente YYYY-MM-DD y ser una fecha válida.`,
      },
    });
  };
}

export const DIAGNOSIS_TYPES = ['PRELIMINARY', 'CONFIRMED', 'RULED_OUT'] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];

export class ClinicalDiagnosisDto {
  @ApiProperty({ maxLength: 300 })
  @RequiredClinicalText(300)
  description: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Código clínico, por ejemplo CIE-10.' })
  @OptionalClinicalText(40)
  code?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'Sistema del código clínico.' })
  @OptionalClinicalText(80)
  codeSystem?: string;

  @ApiPropertyOptional({ enum: DIAGNOSIS_TYPES })
  @IsOptional()
  @IsIn(DIAGNOSIS_TYPES)
  type?: DiagnosisType;
}

export class VitalSignsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 400 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(400)
  systolicBloodPressure?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 300 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(300)
  diastolicBloodPressure?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 400 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(400)
  heartRate?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 150 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(150)
  respiratoryRate?: number;

  @ApiPropertyOptional({ minimum: 20, maximum: 50 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(50)
  temperatureCelsius?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  oxygenSaturation?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 700 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(700)
  weightKg?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 300 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(300)
  heightCm?: number;
}

export class ConsultationDetailsV1Dto {
  @ApiProperty({ maxLength: 1000 })
  @RequiredClinicalText(1000)
  chiefComplaint: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @OptionalClinicalText(4000)
  presentIllness?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @OptionalClinicalText(4000)
  relevantHistory?: string;

  @ApiPropertyOptional({ type: VitalSignsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => VitalSignsDto)
  vitalSigns?: VitalSignsDto;

  @ApiPropertyOptional({ maxLength: 4000 })
  @OptionalClinicalText(4000)
  physicalExam?: string;

  @ApiPropertyOptional({ type: [ClinicalDiagnosisDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ClinicalDiagnosisDto)
  diagnoses?: ClinicalDiagnosisDto[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @OptionalClinicalText(2000)
  followUp?: string;
}

export class EvolutionDetailsV1Dto {
  @ApiProperty({ maxLength: 4000 })
  @RequiredClinicalText(4000)
  evolution: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  subjective?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  objective?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  assessment?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  treatmentResponse?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @OptionalClinicalText(2000)
  incidents?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @OptionalClinicalText(2000)
  followUp?: string;
}

export const LAB_RESULT_FLAGS = ['NORMAL', 'LOW', 'HIGH', 'CRITICAL', 'ABNORMAL'] as const;
export type LabResultFlag = (typeof LAB_RESULT_FLAGS)[number];

export class LabResultItemDto {
  @ApiProperty({ maxLength: 200 })
  @RequiredClinicalText(200)
  analyte: string;

  @ApiProperty({ maxLength: 200, description: 'Resultado cuantitativo o cualitativo.' })
  @RequiredClinicalText(200)
  value: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @OptionalClinicalText(60)
  unit?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @OptionalClinicalText(160)
  referenceRange?: string;

  @ApiPropertyOptional({ enum: LAB_RESULT_FLAGS })
  @IsOptional()
  @IsIn(LAB_RESULT_FLAGS)
  flag?: LabResultFlag;
}

export class LabResultDetailsV1Dto {
  @ApiProperty({ maxLength: 300 })
  @RequiredClinicalText(300)
  studyName: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @OptionalClinicalText(200)
  laboratoryName?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @OptionalClinicalText(300)
  specimen?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsPastOrPresentZonedIsoDateTime()
  collectedAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsPastOrPresentZonedIsoDateTime()
  issuedAt?: string;

  @ApiProperty({ type: [LabResultItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LabResultItemDto)
  results: LabResultItemDto[];

  @ApiPropertyOptional({ maxLength: 4000 })
  @OptionalClinicalText(4000)
  interpretation?: string;
}

export class PrescriptionMedicationDto {
  @ApiProperty({ maxLength: 240 })
  @RequiredClinicalText(240)
  name: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @OptionalClinicalText(160)
  presentation?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @OptionalClinicalText(120)
  concentration?: string;

  @ApiProperty({ maxLength: 160 })
  @RequiredClinicalText(160)
  dose: string;

  @ApiProperty({ maxLength: 120 })
  @RequiredClinicalText(120)
  route: string;

  @ApiProperty({ maxLength: 160 })
  @RequiredClinicalText(160)
  frequency: string;

  @ApiProperty({ maxLength: 160 })
  @RequiredClinicalText(160)
  duration: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @OptionalClinicalText(120)
  quantity?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @OptionalClinicalText(1000)
  instructions?: string;
}

export class PrescriptionDetailsV1Dto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @OptionalClinicalText(1000)
  indication?: string;

  @ApiProperty({ type: [PrescriptionMedicationDto], minItems: 1, maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionMedicationDto)
  medications: PrescriptionMedicationDto[];

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateOnly()
  validFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateOnly()
  validUntil?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  nonPharmacologicalInstructions?: string;
}

export const PROCEDURE_LATERALITY = ['LEFT', 'RIGHT', 'BILATERAL', 'NOT_APPLICABLE'] as const;
export type ProcedureLaterality = (typeof PROCEDURE_LATERALITY)[number];
export const CONSENT_STATUSES = ['DOCUMENTED', 'NOT_REQUIRED', 'UNKNOWN'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export class ProcedureDetailsV1Dto {
  @ApiProperty({ maxLength: 300 })
  @RequiredClinicalText(300)
  procedureName: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @OptionalClinicalText(2000)
  indication?: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @OptionalClinicalText(240)
  bodySite?: string;

  @ApiPropertyOptional({ enum: PROCEDURE_LATERALITY })
  @IsOptional()
  @IsIn(PROCEDURE_LATERALITY)
  laterality?: ProcedureLaterality;

  @ApiPropertyOptional({ enum: CONSENT_STATUSES })
  @IsOptional()
  @IsIn(CONSENT_STATUSES)
  consentStatus?: ConsentStatus;

  @ApiProperty({ maxLength: 5000 })
  @RequiredClinicalText(5000)
  technique: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @OptionalClinicalText(1000)
  anesthesia?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @OptionalClinicalText(4000)
  findings?: string;

  @ApiProperty({ maxLength: 2000, description: 'Registrar complicaciones o declarar que no hubo.' })
  @RequiredClinicalText(2000)
  complications: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @OptionalClinicalText(2000)
  outcome?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  postProcedureCare?: string;
}

export class TherapyMeasurementDto {
  @ApiProperty({ maxLength: 160 })
  @RequiredClinicalText(160)
  name: string;

  @ApiProperty({ maxLength: 160 })
  @RequiredClinicalText(160)
  value: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @OptionalClinicalText(60)
  unit?: string;
}

export class TherapyNoteDetailsV1Dto {
  @ApiProperty({ maxLength: 200 })
  @RequiredClinicalText(200)
  discipline: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  sessionNumber?: number;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  goals?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  baselineStatus?: string;

  @ApiProperty({ maxLength: 5000 })
  @RequiredClinicalText(5000)
  interventions: string;

  @ApiProperty({ maxLength: 4000 })
  @RequiredClinicalText(4000)
  response: string;

  @ApiPropertyOptional({ type: [TherapyMeasurementDto], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TherapyMeasurementDto)
  measurements?: TherapyMeasurementDto[];

  @ApiPropertyOptional({ maxLength: 3000 })
  @OptionalClinicalText(3000)
  homeInstructions?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsZonedIsoDateTime()
  nextSessionAt?: string;
}

export class OtherDetailsV1Dto {
  @ApiProperty({ maxLength: 300 })
  @RequiredClinicalText(300)
  title: string;

  @ApiProperty({ maxLength: 160 })
  @RequiredClinicalText(160)
  category: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @OptionalClinicalText(2000)
  context?: string;

  @ApiProperty({ maxLength: 8000 })
  @RequiredClinicalText(8000)
  content: string;
}

export type ClinicalRecordDetailsV1Dto =
  | ConsultationDetailsV1Dto
  | EvolutionDetailsV1Dto
  | LabResultDetailsV1Dto
  | PrescriptionDetailsV1Dto
  | ProcedureDetailsV1Dto
  | TherapyNoteDetailsV1Dto
  | OtherDetailsV1Dto;

type DetailsConstructor = new () => ClinicalRecordDetailsV1Dto;

const DETAILS_DTO_BY_RECORD_TYPE: Record<RecordType, DetailsConstructor> = {
  [RecordType.CONSULTATION]: ConsultationDetailsV1Dto,
  [RecordType.EVOLUTION]: EvolutionDetailsV1Dto,
  [RecordType.LAB_RESULT]: LabResultDetailsV1Dto,
  [RecordType.PRESCRIPTION]: PrescriptionDetailsV1Dto,
  [RecordType.PROCEDURE]: ProcedureDetailsV1Dto,
  [RecordType.THERAPY_NOTE]: TherapyNoteDetailsV1Dto,
  [RecordType.OTHER]: OtherDetailsV1Dto,
};

function flattenValidationErrors(errors: ValidationError[], parent = 'details'): string[] {
  return errors.flatMap((error) => {
    const path = error.property ? `${parent}.${error.property}` : parent;
    const own = error.constraints
      ? Object.values(error.constraints).map((message) => `${path}: ${message}`)
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], path)];
  });
}

function validateClinicalDateOrder(
  recordType: RecordType,
  details: ClinicalRecordDetailsV1Dto,
): string[] {
  if (recordType === RecordType.LAB_RESULT) {
    const lab = details as LabResultDetailsV1Dto;
    if (
      lab.collectedAt &&
      lab.issuedAt &&
      new Date(lab.issuedAt).getTime() < new Date(lab.collectedAt).getTime()
    ) {
      return ['details.issuedAt: no puede ser anterior a details.collectedAt.'];
    }
  }

  if (recordType === RecordType.PRESCRIPTION) {
    const prescription = details as PrescriptionDetailsV1Dto;
    if (
      prescription.validFrom &&
      prescription.validUntil &&
      prescription.validUntil < prescription.validFrom
    ) {
      return ['details.validUntil: no puede ser anterior a details.validFrom.'];
    }
  }

  return [];
}

function pruneIncompleteDraftValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const items = value.map(pruneIncompleteDraftValue).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, child]) => [key, pruneIncompleteDraftValue(child)] as const)
      .filter(([, child]) => child !== undefined);
    return Object.fromEntries(entries);
  }
  return value;
}

export interface DetailsValidationResult {
  value: Prisma.InputJsonObject | null;
  errors: string[];
}

export function validateClinicalRecordDetails(
  recordType: RecordType | undefined,
  details: unknown,
  options: { partial?: boolean } = {},
): DetailsValidationResult {
  if (!recordType) {
    return { value: null, errors: ['recordType es obligatorio para validar details.'] };
  }
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return { value: null, errors: ['details debe ser un objeto.'] };
  }

  const DetailsDto = DETAILS_DTO_BY_RECORD_TYPE[recordType];
  const candidate = options.partial ? (pruneIncompleteDraftValue(details) ?? {}) : details;
  const instance = plainToInstance(DetailsDto, candidate);
  const validationErrors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    skipMissingProperties: options.partial ?? false,
    validationError: { target: false, value: false },
  });
  const errors = [
    ...flattenValidationErrors(validationErrors),
    ...(validationErrors.length === 0 ? validateClinicalDateOrder(recordType, instance) : []),
  ];
  if (errors.length > 0) return { value: null, errors };

  return {
    value: JSON.parse(JSON.stringify(instance)) as Prisma.InputJsonObject,
    errors: [],
  };
}

export function IsClinicalRecordDetails(
  options: { partial?: boolean } = {},
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isClinicalRecordDetails',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      constraints: [options],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const recordType = (args.object as { recordType?: RecordType }).recordType;
          return validateClinicalRecordDetails(recordType, value, options).errors.length === 0;
        },
        defaultMessage(args: ValidationArguments) {
          const recordType = (args.object as { recordType?: RecordType }).recordType;
          return validateClinicalRecordDetails(recordType, args.value, options).errors.join(' ');
        },
      },
    });
  };
}

export const CLINICAL_DETAILS_SWAGGER_MODELS = [
  ClinicalDiagnosisDto,
  VitalSignsDto,
  ConsultationDetailsV1Dto,
  EvolutionDetailsV1Dto,
  LabResultItemDto,
  LabResultDetailsV1Dto,
  PrescriptionMedicationDto,
  PrescriptionDetailsV1Dto,
  ProcedureDetailsV1Dto,
  TherapyMeasurementDto,
  TherapyNoteDetailsV1Dto,
  OtherDetailsV1Dto,
] as const;

export const ClinicalDetailsApiModels = () => ApiExtraModels(...CLINICAL_DETAILS_SWAGGER_MODELS);

export const CLINICAL_DETAILS_ONE_OF = {
  oneOf: [
    ConsultationDetailsV1Dto,
    EvolutionDetailsV1Dto,
    LabResultDetailsV1Dto,
    PrescriptionDetailsV1Dto,
    ProcedureDetailsV1Dto,
    TherapyNoteDetailsV1Dto,
    OtherDetailsV1Dto,
  ].map((model) => ({ $ref: getSchemaPath(model) })),
  description: 'El esquema concreto se discrimina mediante recordType; versión soportada: 1.',
} as const;

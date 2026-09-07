import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { CreatePatientDto } from './create-patient.dto';

// documentType + documentNumber no se pueden cambiar (identifican al paciente).
export class UpdatePatientDto extends PartialType(
  OmitType(CreatePatientDto, [
    'documentType',
    'documentNumber',
    'draftId',
    'expectedDraftVersion',
  ] as const),
  { skipNullProperties: false },
) {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

export class PatientVersionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

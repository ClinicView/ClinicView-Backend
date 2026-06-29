import { OmitType, PartialType } from '@nestjs/swagger';
import { CreatePatientDto } from './create-patient.dto';

// documentType + documentNumber no se pueden cambiar (identifican al paciente).
export class UpdatePatientDto extends PartialType(
  OmitType(CreatePatientDto, ['documentType', 'documentNumber'] as const),
) {}

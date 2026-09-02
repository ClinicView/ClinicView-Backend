import { validate } from 'class-validator';
import { DocumentType, Sex } from '@prisma/client';
import { CreatePatientDto } from '../dto/create-patient.dto';
import { UpdatePatientDto } from '../dto/update-patient.dto';

function createDto(dateOfBirth: string): CreatePatientDto {
  return Object.assign(new CreatePatientDto(), {
    documentType: DocumentType.DNI,
    documentNumber: '12345678',
    firstName: 'María',
    lastName: 'Quispe',
    dateOfBirth,
    sex: Sex.F,
  });
}

describe('Patient date-only contract', () => {
  it('acepta una fecha civil válida en formato YYYY-MM-DD', async () => {
    const errors = await validate(createDto('1985-06-15'));
    expect(errors.find((error) => error.property === 'dateOfBirth')).toBeUndefined();
  });

  it.each([
    '1985-06-15T00:00:00Z',
    '15/06/1985',
    '1985-02-30',
    '1985-06-15Trash',
    '2999-01-01',
  ])('rechaza una fecha civil ambigua o inválida: %s', async (dateOfBirth) => {
    const errors = await validate(createDto(dateOfBirth));
    expect(errors.find((error) => error.property === 'dateOfBirth')).toBeDefined();
  });

  it('aplica también la regla de fecha no futura al actualizar', async () => {
    const dto = Object.assign(new UpdatePatientDto(), { dateOfBirth: '2999-01-01' });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'dateOfBirth')).toBeDefined();
  });
});

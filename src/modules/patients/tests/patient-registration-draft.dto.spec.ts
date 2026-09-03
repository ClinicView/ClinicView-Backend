import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentType, Sex } from '@prisma/client';
import { UpsertPatientRegistrationDraftDto } from '../dto/patient-registration-draft.dto';

describe('UpsertPatientRegistrationDraftDto', () => {
  const validateDto = (value: unknown) =>
    validate(plainToInstance(UpsertPatientRegistrationDraftDto, value), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('acepta un snapshot parcial tipado del alta', async () => {
    const errors = await validateDto({
      payload: {
        documentType: DocumentType.DNI,
        documentNumber: '1234',
        firstName: 'María',
        sex: Sex.F,
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('rechaza propiedades arbitrarias dentro del payload', async () => {
    const errors = await validateDto({
      payload: { firstName: 'María', secretNote: 'no permitido' },
    });

    expect(errors).not.toHaveLength(0);
    expect(JSON.stringify(errors)).toContain('secretNote');
  });

  it('rechaza fecha futura y datos que superan los límites del alta', async () => {
    const errors = await validateDto({
      payload: {
        dateOfBirth: '2999-01-01',
        documentNumber: '1'.repeat(21),
      },
    });

    expect(errors).not.toHaveLength(0);
    expect(JSON.stringify(errors)).toContain('dateOfBirth');
    expect(JSON.stringify(errors)).toContain('documentNumber');
  });
});

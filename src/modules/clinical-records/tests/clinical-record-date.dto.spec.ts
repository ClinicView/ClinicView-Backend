import { validate } from 'class-validator';
import { RecordType } from '@prisma/client';
import { CorrectRecordDto } from '../dto/correct-record.dto';
import { CreateRecordDto } from '../dto/create-record.dto';

function createDto(attendedAt: string): CreateRecordDto {
  return Object.assign(new CreateRecordDto(), {
    recordType: RecordType.CONSULTATION,
    attendedAt,
    summary: 'Control clínico',
  });
}

describe('Clinical record date contracts', () => {
  it.each([
    '2026-09-02T09:30:00-05:00',
    '2026-09-02T14:30:00Z',
  ])('acepta un instante ISO con zona explícita: %s', async (attendedAt) => {
    const errors = await validate(createDto(attendedAt));
    expect(errors.find((error) => error.property === 'attendedAt')).toBeUndefined();
  });

  it('rechaza un datetime local ambiguo sin zona horaria', async () => {
    const errors = await validate(createDto('2026-09-02T09:30'));
    expect(errors.find((error) => error.property === 'attendedAt')).toBeDefined();
  });

  it('permite omitir la fecha en una corrección para heredar el instante original', async () => {
    const dto = Object.assign(new CorrectRecordDto(), { summary: 'Resumen corregido' });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'attendedAt')).toBeUndefined();
  });

  it('rechaza una fecha de corrección sin zona horaria', async () => {
    const dto = Object.assign(new CorrectRecordDto(), {
      attendedAt: '2026-09-02T09:30',
      summary: 'Resumen corregido',
    });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'attendedAt')).toBeDefined();
  });
});

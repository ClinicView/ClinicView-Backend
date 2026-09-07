import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRecordDto } from '../dto/create-record.dto';
import { recordAttendance } from '../dto/record-attendance';

describe('clinical attendance precision', () => {
  it('accepts a civil date only with explicit DAY precision', async () => {
    const payload = { recordType: 'CONSULTATION', summary: 'Ejemplo', details: { chiefComplaint: 'Ejemplo', physicalExam: 'Ejemplo' }, attendedAt: '2023-09-27' };
    expect((await validate(plainToInstance(CreateRecordDto, payload))).some((error) => error.property === 'attendedAt')).toBe(true);
    expect(await validate(plainToInstance(CreateRecordDto, { ...payload, attendancePrecision: 'DAY' }))).toHaveLength(0);
    expect(recordAttendance(payload.attendedAt, 'DAY').toISOString()).toBe('2023-09-27T05:00:00.000Z');
  });
  it('rejects invented dates and mismatched precision', () => {
    expect(() => recordAttendance('2023-02-30', 'DAY')).toThrow();
    expect(() => recordAttendance('2999-01-01', 'DAY')).toThrow();
    expect(() => recordAttendance('2023-09-27T15:30:00Z', 'DAY')).toThrow();
    expect(recordAttendance('2023-09-27T15:30:00Z').toISOString()).toBe('2023-09-27T15:30:00.000Z');
  });
});

import {
  currentDateOnlyInClinicalTimeZone,
  databaseDateToDateOnly,
  dateOnlyToDatabaseDate,
  isPastOrPresentDateOnly,
  isPastOrPresentZonedIsoDateTime,
  isValidDateOnly,
  isZonedIsoDateTime,
  parseClinicalDateFilter,
} from './clinical-date';

describe('clinical-date', () => {
  it('valida fechas civiles exactas, incluyendo años bisiestos', () => {
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2023-02-29')).toBe(false);
    expect(isValidDateOnly('2024-02-29T00:00:00Z')).toBe(false);
    expect(isValidDateOnly('2024-02-29Trash')).toBe(false);
  });

  it('determina hoy con el calendario de America/Lima', () => {
    const beforeMidnightInLima = new Date('2026-09-03T04:59:59.999Z');
    expect(currentDateOnlyInClinicalTimeZone(beforeMidnightInLima)).toBe('2026-09-02');
    expect(isPastOrPresentDateOnly('2026-09-03', beforeMidnightInLima)).toBe(false);
  });

  it('exige zona explícita y compara attendedAt como instante', () => {
    const now = new Date('2026-09-02T15:00:00.000Z');
    expect(isZonedIsoDateTime('2026-09-02T09:30:00-05:00')).toBe(true);
    expect(isZonedIsoDateTime('2026-09-02T09:30:00')).toBe(false);
    expect(isPastOrPresentZonedIsoDateTime('2026-09-02T10:00:00-05:00', now)).toBe(
      true,
    );
    expect(isPastOrPresentZonedIsoDateTime('2026-09-02T10:00:00.001-05:00', now)).toBe(
      false,
    );
  });

  it('convierte date-only a almacenamiento y respuesta sin cambio de día', () => {
    expect(dateOnlyToDatabaseDate('1985-06-15').toISOString()).toBe(
      '1985-06-15T00:00:00.000Z',
    );
    expect(databaseDateToDateOnly(new Date('1985-06-15T00:00:00.000Z'))).toBe(
      '1985-06-15',
    );
  });

  it('normaliza un filtro date-only al día Lima y deja ISO como límite inclusivo', () => {
    expect(parseClinicalDateFilter('2026-09-02', 'from')).toEqual({
      date: new Date('2026-09-02T05:00:00.000Z'),
      exclusive: false,
    });
    expect(parseClinicalDateFilter('2026-09-02', 'to')).toEqual({
      date: new Date('2026-09-03T05:00:00.000Z'),
      exclusive: true,
    });
    expect(parseClinicalDateFilter('2026-09-02T18:00:00-05:00', 'to')).toEqual({
      date: new Date('2026-09-02T23:00:00.000Z'),
      exclusive: false,
    });
  });
});

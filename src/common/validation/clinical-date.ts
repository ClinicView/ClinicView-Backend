import { isISO8601, registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

export const CLINICAL_TIME_ZONE = 'America/Lima';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPLICIT_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/;

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

export interface ClinicalDateFilterBound {
  date: Date;
  exclusive: boolean;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDateOnlyParts(value: string): CalendarDateParts | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatDateParts(parts: CalendarDateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

function utcMillisecondsFromParts(
  parts: CalendarDateParts,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function datePartsInTimeZone(date: Date, timeZone: string): CalendarDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) throw new RangeError(`No se pudo obtener ${type} en ${timeZone}.`);
    return Number(value);
  };

  return { year: part('year'), month: part('month'), day: part('day') };
}

function timeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) throw new RangeError(`No se pudo obtener ${type} en ${timeZone}.`);
    return Number(value);
  };

  const representedAsUtc = utcMillisecondsFromParts(
    { year: part('year'), month: part('month'), day: part('day') },
    part('hour'),
    part('minute'),
    part('second'),
  );
  const instantAtWholeSecond = Math.floor(date.getTime() / 1000) * 1000;

  return representedAsUtc - instantAtWholeSecond;
}

function startOfDateInTimeZone(parts: CalendarDateParts, timeZone: string): Date {
  const localMidnightAsUtc = utcMillisecondsFromParts(parts);
  let instant = localMidnightAsUtc;

  // Recalcular cubre cambios históricos de offset sin fijar UTC-05:00 en el código.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const adjusted =
      localMidnightAsUtc - timeZoneOffsetMilliseconds(new Date(instant), timeZone);
    if (adjusted === instant) break;
    instant = adjusted;
  }

  return new Date(instant);
}

function addCalendarDay(parts: CalendarDateParts): CalendarDateParts {
  const next = new Date(utcMillisecondsFromParts({ ...parts, day: parts.day + 1 }));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function isValidDateOnly(value: unknown): value is string {
  return typeof value === 'string' && parseDateOnlyParts(value) !== null;
}

export function currentDateOnlyInClinicalTimeZone(now = new Date()): string {
  return formatDateParts(datePartsInTimeZone(now, CLINICAL_TIME_ZONE));
}

export function isPastOrPresentDateOnly(
  value: unknown,
  now = new Date(),
): value is string {
  return (
    isValidDateOnly(value) && value <= currentDateOnlyInClinicalTimeZone(now)
  );
}

export function isZonedIsoDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.includes('T') &&
    EXPLICIT_TIME_ZONE_PATTERN.test(value) &&
    isISO8601(value, { strict: true, strictSeparator: true }) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isPastOrPresentZonedIsoDateTime(
  value: unknown,
  now = new Date(),
): value is string {
  return isZonedIsoDateTime(value) && Date.parse(value) <= now.getTime();
}

export function isClinicalDateFilter(value: unknown): value is string {
  return isValidDateOnly(value) || isZonedIsoDateTime(value);
}

export function dateOnlyToDatabaseDate(value: string): Date {
  if (!isValidDateOnly(value)) {
    throw new RangeError('La fecha debe usar exactamente YYYY-MM-DD y ser válida.');
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function databaseDateToDateOnly(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError('La fecha almacenada no es válida.');
  return value.toISOString().slice(0, 10);
}

export function parseClinicalDateFilter(
  value: string,
  edge: 'from' | 'to',
): ClinicalDateFilterBound {
  const dateOnlyParts = parseDateOnlyParts(value);
  if (dateOnlyParts) {
    const boundaryParts = edge === 'to' ? addCalendarDay(dateOnlyParts) : dateOnlyParts;
    return {
      date: startOfDateInTimeZone(boundaryParts, CLINICAL_TIME_ZONE),
      exclusive: edge === 'to',
    };
  }

  if (!isZonedIsoDateTime(value)) {
    throw new RangeError(
      'El filtro debe ser YYYY-MM-DD o un instante ISO 8601 con zona horaria explícita.',
    );
  }

  return { date: new Date(value), exclusive: false };
}

export function IsPastOrPresentClinicalDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isPastOrPresentClinicalDate',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isPastOrPresentDateOnly(value),
        defaultMessage: () =>
          'dateOfBirth debe usar exactamente YYYY-MM-DD, ser válida y no estar en el futuro en America/Lima.',
      },
    });
  };
}

export function IsPastOrPresentZonedIsoDateTime(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isPastOrPresentZonedIsoDateTime',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isPastOrPresentZonedIsoDateTime(value),
        defaultMessage: () =>
          'attendedAt debe ser un instante ISO 8601 con zona horaria explícita y no estar en el futuro.',
      },
    });
  };
}

export function IsClinicalDateFilter(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isClinicalDateFilter',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isClinicalDateFilter(value),
        defaultMessage: () =>
          'El filtro debe ser YYYY-MM-DD o un instante ISO 8601 con zona horaria explícita.',
      },
    });
  };
}

import { BadRequestException } from '@nestjs/common';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import {
  isPastOrPresentDateOnly,
  isPastOrPresentZonedIsoDateTime,
  parseClinicalDateFilter,
} from '../../../common/validation/clinical-date';

export type AttendancePrecision = 'INSTANT' | 'DAY';

export function IsRecordAttendance(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isRecordAttendance',
      target: target.constructor,
      propertyName: String(propertyKey),
      options,
      validator: {
        validate(value: unknown, args) {
          const precision =
            (args?.object as { attendancePrecision?: string }).attendancePrecision ?? 'INSTANT';
          return precision === 'DAY'
            ? isPastOrPresentDateOnly(value)
            : precision === 'INSTANT' && isPastOrPresentZonedIsoDateTime(value);
        },
        defaultMessage: () =>
          'Indica una fecha real no futura (DAY) o un instante con zona horaria (INSTANT).',
      },
    });
}

export function recordAttendance(value: string, precision: string = 'INSTANT'): Date {
  if (precision === 'DAY' && isPastOrPresentDateOnly(value))
    return parseClinicalDateFilter(value, 'from').date;
  if (precision === 'INSTANT' && isPastOrPresentZonedIsoDateTime(value)) return new Date(value);
  throw new BadRequestException(
    'La fecha no corresponde a la precisión declarada o está en el futuro.',
  );
}

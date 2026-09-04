import { AuditOutcome } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindAuditEventsQueryDto } from '../dto/find-audit-events-query.dto';

const UUID = 'bd1d134f-64ac-435d-a836-70fdf0764f70';

async function errorsFor(value: Record<string, unknown>) {
  return validate(plainToInstance(FindAuditEventsQueryDto, value));
}

describe('FindAuditEventsQueryDto', () => {
  it('acepta el conjunto completo de filtros seguros y transforma limit', async () => {
    const value = plainToInstance(FindAuditEventsQueryDto, {
      cursor: UUID,
      limit: '100',
      action: 'CLINICAL_RECORD_VIEWED',
      outcome: AuditOutcome.DENIED,
      actorId: UUID,
      actorUsername: 'mlopez',
      patientId: UUID,
      resourceType: 'CLINICAL_RECORD',
      resourceId: UUID,
      requestId: UUID,
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-03T23:59:59.999Z',
    });

    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value.limit).toBe(100);
  });

  it.each([
    ['cursor', 'patient@example.org'],
    ['actorId', '../../admin'],
    ['actorUsername', 'admin@hospital.org'],
    ['patientId', '87654321'],
    ['resourceId', '<script>'],
    ['requestId', 'request-123'],
    ['limit', 0],
    ['limit', 101],
    ['limit', 1.5],
    ['action', 'patient_viewed'],
    ['action', 'PATIENT-VIEWED'],
    ['resourceType', 'PATIENT/../../USER'],
    ['outcome', 'UNKNOWN'],
    ['from', '2026-09-01 00:00:00'],
    ['to', '03/09/2026'],
  ])('rechaza el filtro inseguro %s=%p', async (property, value) => {
    const errors = await errorsFor({ [property]: value });
    expect(errors).not.toHaveLength(0);
    expect(errors[0]?.property).toBe(property);
  });
});

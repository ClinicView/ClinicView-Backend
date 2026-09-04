import { AuditEvent, AuditOutcome } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditRepository, type FindAuditEventsInput } from '../audit.repository';

const FIRST_ID = 'bd1d134f-64ac-435d-a836-70fdf0764f70';
const SECOND_ID = '3bbf7433-50c0-4473-8987-e685db9a0f4e';
const THIRD_ID = '6cc2a08f-9e94-471b-9d71-6fd3d91be8ae';
const ACTOR_ID = 'bf76ac74-5c2a-4dc7-a82e-e67c18b7f964';
const PATIENT_ID = 'd6484bb7-bf13-4d21-934d-f337e6ef4445';
const RESOURCE_ID = '79c84f4d-8a39-45ed-a6bf-0f0e805b579e';
const REQUEST_ID = '1b8f3540-1af3-42f9-90be-f13485e66bbd';

function event(id: string, occurredAt: string): AuditEvent {
  return {
    id,
    occurredAt: new Date(occurredAt),
    action: 'PATIENT_VIEWED',
    outcome: AuditOutcome.SUCCESS,
    actorId: ACTOR_ID,
    actorUsernameAtEvent: 'mlopez',
    patientId: PATIENT_ID,
    resourceType: 'PATIENT',
    resourceId: RESOURCE_ID,
    requestId: REQUEST_ID,
    method: 'GET',
    route: '/patients/:id',
    statusCode: 200,
    durationMs: 8,
    ipHash: 'a'.repeat(64),
    userAgentHash: 'b'.repeat(64),
  };
}

describe('AuditRepository', () => {
  it('construye una consulta solo con filtros permitidos y paginación por cursor', async () => {
    const rows = [
      event(FIRST_ID, '2026-09-03T12:00:00.000Z'),
      event(SECOND_ID, '2026-09-03T11:00:00.000Z'),
      event(THIRD_ID, '2026-09-03T10:00:00.000Z'),
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const repository = new AuditRepository({
      auditEvent: { findMany },
    } as unknown as PrismaService);
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-03T23:59:59.999Z');
    const input = {
      cursor: FIRST_ID,
      limit: 2,
      action: 'PATIENT_VIEWED',
      outcome: AuditOutcome.SUCCESS,
      actorId: ACTOR_ID,
      actorUsername: 'mlopez',
      patientId: PATIENT_ID,
      resourceType: 'PATIENT',
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      from,
      to,
      body: 'historia clínica que nunca debe entrar al query',
    } as FindAuditEventsInput & { body: string };

    await expect(repository.findMany(input)).resolves.toEqual({
      data: rows.slice(0, 2),
      nextCursor: SECOND_ID,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        action: 'PATIENT_VIEWED',
        outcome: AuditOutcome.SUCCESS,
        actorId: ACTOR_ID,
        OR: [{ actorUsernameAtEvent: 'mlopez' }, { actor: { is: { username: 'mlopez' } } }],
        patientId: PATIENT_ID,
        resourceType: 'PATIENT',
        resourceId: RESOURCE_ID,
        requestId: REQUEST_ID,
        occurredAt: { gte: from, lte: to },
      },
      include: {
        actor: {
          select: {
            username: true,
            fullName: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 3,
      cursor: { id: FIRST_ID },
      skip: 1,
    });
    expect(JSON.stringify(findMany.mock.calls[0][0])).not.toContain('historia clínica');
  });

  it('devuelve nextCursor nulo cuando no existe otra página', async () => {
    const row = event(FIRST_ID, '2026-09-03T12:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([row]);
    const repository = new AuditRepository({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    await expect(repository.findMany({ limit: 2 })).resolves.toEqual({
      data: [row],
      nextCursor: null,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      include: {
        actor: {
          select: {
            username: true,
            fullName: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
  });

  it('busca el cursor exclusivamente por id y selecciona solo ese campo', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: FIRST_ID });
    const repository = new AuditRepository({
      auditEvent: { findUnique },
    } as unknown as PrismaService);

    await expect(repository.findById(FIRST_ID)).resolves.toEqual({ id: FIRST_ID });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: FIRST_ID },
      select: { id: true },
    });
  });
});

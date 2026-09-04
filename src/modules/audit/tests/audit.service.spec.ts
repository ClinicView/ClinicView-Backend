import { BadRequestException, Logger } from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import type { Request } from 'express';
import {
  RequestContextService,
  type RequestContextState,
} from '../../../core/request-context/request-context.service';
import type { AuditPolicy } from '../audit.decorator';
import { AuditRepository } from '../audit.repository';
import { AuditService } from '../audit.service';

const REQUEST_ID = '1b8f3540-1af3-42f9-90be-f13485e66bbd';
const ACTOR_ID = 'bf76ac74-5c2a-4dc7-a82e-e67c18b7f964';
const CONTEXT_ACTOR_ID = '56f4855e-9a54-4566-a2cd-e6c9f56b8d18';
const PATIENT_ID = 'd6484bb7-bf13-4d21-934d-f337e6ef4445';
const RESOURCE_ID = '79c84f4d-8a39-45ed-a6bf-0f0e805b579e';
const CURSOR_ID = 'ca98a3db-ddc5-441d-8d9a-c5a075c3ba1a';

type RepositoryMock = {
  create: jest.Mock;
  findById: jest.Mock;
  findMany: jest.Mock;
};

function auditContext(policy: AuditPolicy): RequestContextState {
  return {
    requestId: REQUEST_ID,
    startedAt: 1_800_000_000_000,
    ipHash: 'a'.repeat(64),
    userAgentHash: 'b'.repeat(64),
    method: 'POST',
    route: '/patients/:patientId/records/:recordId',
    auditPolicy: policy,
    actorId: CONTEXT_ACTOR_ID,
    actorUsernameAtEvent: 'context.actor',
    skipAudit: false,
  };
}

function createHarness(policy: AuditPolicy) {
  const repository: RepositoryMock = {
    create: jest.fn().mockResolvedValue({ id: 'audit-event-id' }),
    findById: jest.fn(),
    findMany: jest.fn(),
  };
  const context = auditContext(policy);
  const requestContext = {
    get: jest.fn<RequestContextState | undefined, []>(() => context),
  };
  const service = new AuditService(
    repository as unknown as AuditRepository,
    requestContext as unknown as RequestContextService,
  );
  return { context, repository, requestContext, service };
}

function protectedRequest(
  userSub: unknown = ACTOR_ID,
  params: Record<string, string> = {
    patientId: PATIENT_ID,
    recordId: RESOURCE_ID,
  },
): Request {
  const request: Record<string, unknown> = {
    user: { sub: userSub, username: 'mlopez' },
    params,
  };
  for (const property of ['body', 'query', 'error', 'originalUrl', 'url', 'headers']) {
    Object.defineProperty(request, property, {
      enumerable: true,
      get: () => {
        throw new Error(`AuditService intentó leer el campo prohibido request.${property}`);
      },
    });
  }
  return request as unknown as Request;
}

describe('AuditService.recordHttp', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([AuditOutcome.SUCCESS, AuditOutcome.DENIED, AuditOutcome.FAILED])(
    'persiste %s usando solo el contexto y los identificadores UUID permitidos',
    async (outcome) => {
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_125);
      const { repository, service } = createHarness({
        action: 'CLINICAL_RECORD_VIEWED',
        resourceType: 'CLINICAL_RECORD',
        patientParam: 'patientId',
        resourceParam: 'recordId',
      });
      const request = protectedRequest();
      const responseWithSensitiveFields = {} as Record<string, unknown>;
      Object.defineProperty(responseWithSensitiveFields, 'medicalNotes', {
        get: () => {
          throw new Error('No debe inspeccionar la respuesta clínica');
        },
      });

      await expect(
        service.recordHttp(
          request,
          outcome,
          outcome === AuditOutcome.SUCCESS ? 200 : 403,
          responseWithSensitiveFields,
        ),
      ).resolves.toBeUndefined();

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledWith({
        action: 'CLINICAL_RECORD_VIEWED',
        outcome,
        actorId: ACTOR_ID,
        actorUsernameAtEvent: 'mlopez',
        patientId: PATIENT_ID,
        resourceType: 'CLINICAL_RECORD',
        resourceId: RESOURCE_ID,
        requestId: REQUEST_ID,
        method: 'POST',
        route: '/patients/:patientId/records/:recordId',
        statusCode: outcome === AuditOutcome.SUCCESS ? 200 : 403,
        durationMs: 125,
        ipHash: 'a'.repeat(64),
        userAgentHash: 'b'.repeat(64),
      });
    },
  );

  it('solo toma response.id cuando la política lo permite y el valor es UUID', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_001);
    const { repository, service } = createHarness({
      action: 'PATIENT_CREATED',
      resourceType: 'PATIENT',
      resourceFromResponseId: true,
    });
    const response = { id: RESOURCE_ID } as Record<string, unknown>;
    Object.defineProperty(response, 'patientDocumentNumber', {
      get: () => {
        throw new Error('No debe leer campos distintos de response.id');
      },
    });

    await service.recordHttp(
      protectedRequest(ACTOR_ID, { id: PATIENT_ID }),
      AuditOutcome.SUCCESS,
      201,
      response,
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR_ID,
        patientId: PATIENT_ID,
        resourceId: RESOURCE_ID,
      }),
    );
  });

  it('descarta actor, paciente y recurso cuando no son UUID válidos', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_001);
    const { context, repository, service } = createHarness({
      action: 'PATIENT_CREATED',
      resourceType: 'PATIENT',
      patientParam: 'patientId',
      resourceFromResponseId: true,
    });
    context.actorId = 'admin@example.org';

    await service.recordHttp(
      protectedRequest('../../etc/passwd', {
        patientId: 'DNI-87654321',
        id: 'not-a-uuid',
      }),
      AuditOutcome.SUCCESS,
      201,
      { id: 'record-id<script>alert(1)</script>' },
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorUsernameAtEvent: null,
        patientId: null,
        resourceId: null,
      }),
    );
    expect(JSON.stringify(repository.create.mock.calls[0][0])).not.toContain('87654321');
    expect(JSON.stringify(repository.create.mock.calls[0][0])).not.toContain('etc/passwd');
    expect(JSON.stringify(repository.create.mock.calls[0][0])).not.toContain('<script>');
  });

  it('usa el actor del contexto solo como fallback UUID', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_001);
    const { repository, service } = createHarness({ action: 'AUTH_LOGIN' });

    await service.recordHttp(protectedRequest(null, {}), AuditOutcome.SUCCESS, 200);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: CONTEXT_ACTOR_ID,
        actorUsernameAtEvent: 'context.actor',
      }),
    );
  });

  it('descarta usernames que puedan contener correo u otro texto no permitido', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_001);
    const { context, repository, service } = createHarness({ action: 'PATIENT_VIEWED' });
    context.actorUsernameAtEvent = 'admin@hospital.org';
    const request = protectedRequest(ACTOR_ID, {});
    (request as Request & { user: { sub: string; username: string } }).user.username =
      'admin@hospital.org';

    await service.recordHttp(request, AuditOutcome.SUCCESS, 200);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR_ID, actorUsernameAtEvent: null }),
    );
    expect(JSON.stringify(repository.create.mock.calls[0][0])).not.toContain('@hospital.org');
  });

  it('no escribe cuando falta contexto, política o se marcó SkipAudit', async () => {
    const { context, repository, requestContext, service } = createHarness({
      action: 'HTTP_GET',
    });
    context.skipAudit = true;
    await service.recordHttp(protectedRequest(), AuditOutcome.SUCCESS, 200);
    context.skipAudit = false;
    context.auditPolicy = null;
    await service.recordHttp(protectedRequest(), AuditOutcome.SUCCESS, 200);
    requestContext.get.mockReturnValueOnce(undefined);
    await service.recordHttp(protectedRequest(), AuditOutcome.SUCCESS, 200);

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('tolera un fallo de escritura sin leer ni registrar error.message', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_001);
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { repository, service } = createHarness({ action: 'HTTP_GET' });
    const databaseError: Record<string, unknown> = { code: 'P2002' };
    Object.defineProperty(databaseError, 'message', {
      enumerable: true,
      get: () => {
        throw new Error('No debe leer error.message');
      },
    });
    repository.create.mockRejectedValue(databaseError);

    await expect(
      service.recordHttp(protectedRequest(ACTOR_ID, {}), AuditOutcome.FAILED, 500),
    ).resolves.toBeUndefined();

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'audit_write_failed',
        requestId: REQUEST_ID,
        action: 'HTTP_GET',
        errorCode: 'P2002',
      }),
    );
  });
});

describe('AuditService.findMany', () => {
  it('aplica filtros estrictos, convierte el rango y usa límite por defecto', async () => {
    const { repository, service } = createHarness({ action: 'AUDIT_EVENTS_VIEWED' });
    const page = { data: [], nextCursor: null };
    repository.findMany.mockResolvedValue(page);
    const query = {
      action: 'PATIENT_VIEWED',
      outcome: AuditOutcome.SUCCESS,
      actorId: ACTOR_ID,
      actorUsername: 'mlopez',
      patientId: PATIENT_ID,
      resourceType: 'PATIENT',
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-03T23:59:59.999Z',
    };

    await expect(service.findMany(query)).resolves.toBe(page);

    expect(repository.findMany).toHaveBeenCalledWith({
      ...query,
      limit: 50,
      from: new Date(query.from),
      to: new Date(query.to),
    });
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('valida que el cursor exista antes de consultar la página', async () => {
    const { repository, service } = createHarness({ action: 'AUDIT_EVENTS_VIEWED' });
    const page = { data: [], nextCursor: null };
    repository.findById.mockResolvedValue({ id: CURSOR_ID });
    repository.findMany.mockResolvedValue(page);

    await expect(service.findMany({ cursor: CURSOR_ID, limit: 10 })).resolves.toBe(page);

    expect(repository.findById).toHaveBeenCalledWith(CURSOR_ID);
    expect(repository.findMany).toHaveBeenCalledWith({
      cursor: CURSOR_ID,
      limit: 10,
      from: undefined,
      to: undefined,
    });
  });

  it('rechaza un cursor inexistente sin ejecutar la consulta principal', async () => {
    const { repository, service } = createHarness({ action: 'AUDIT_EVENTS_VIEWED' });
    repository.findById.mockResolvedValue(null);

    await expect(service.findMany({ cursor: CURSOR_ID })).rejects.toThrow(BadRequestException);
    expect(repository.findMany).not.toHaveBeenCalled();
  });

  it('rechaza un rango invertido antes de tocar el repositorio', async () => {
    const { repository, service } = createHarness({ action: 'AUDIT_EVENTS_VIEWED' });

    await expect(
      service.findMany({
        cursor: CURSOR_ID,
        from: '2026-09-04T00:00:00.000Z',
        to: '2026-09-03T00:00:00.000Z',
      }),
    ).rejects.toThrow('El inicio del rango no puede ser posterior al final.');
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.findMany).not.toHaveBeenCalled();
  });
});

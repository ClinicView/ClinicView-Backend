import {
  BadRequestException,
  ForbiddenException,
  type ArgumentsHost,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AuditOutcome } from '@prisma/client';
import type { Request } from 'express';
import { RequestContextService } from '../../../core/request-context/request-context.service';
import { AuditExceptionFilter } from '../audit-exception.filter';
import { AuditService } from '../audit.service';

const ACTOR_ID = 'bf76ac74-5c2a-4dc7-a82e-e67c18b7f964';

function httpHost(request: Partial<Request>, response: object): ArgumentsHost {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    getArgByIndex: (index: number) => (index === 1 ? response : request),
  } as unknown as ArgumentsHost;
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('AuditExceptionFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('espera registrar un acceso denegado antes de responder', async () => {
    let finishPersistence: (() => void) | undefined;
    const pendingPersistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const auditService = {
      recordHttp: jest.fn().mockReturnValue(pendingPersistence),
    };
    const requestContext = { setActor: jest.fn() };
    const adapter = {
      isHeadersSent: jest.fn().mockReturnValue(false),
      reply: jest.fn(),
      end: jest.fn(),
    };
    const filter = new AuditExceptionFilter(
      { httpAdapter: adapter } as unknown as HttpAdapterHost,
      auditService as unknown as AuditService,
      requestContext as unknown as RequestContextService,
    );
    const request = {
      user: { sub: ACTOR_ID },
      body: { diagnosis: 'dato clínico sensible' },
    } as Partial<Request>;
    const response = {};
    const exception = new ForbiddenException('Permiso insuficiente');

    filter.catch(exception, httpHost(request, response));
    await Promise.resolve();

    expect(requestContext.setActor).toHaveBeenCalledWith(ACTOR_ID);
    expect(auditService.recordHttp).toHaveBeenCalledWith(request, AuditOutcome.DENIED, 403);
    expect(auditService.recordHttp.mock.calls[0]).toHaveLength(3);
    expect(auditService.recordHttp.mock.calls[0]).not.toContain(exception);
    expect(adapter.reply).not.toHaveBeenCalled();

    if (!finishPersistence) throw new Error('No se inicializó la promesa diferida.');
    finishPersistence();
    await flushAsyncWork();

    expect(adapter.reply).toHaveBeenCalledWith(response, exception.getResponse(), 403);
  });

  it.each([
    [new UnauthorizedException('token sensible'), AuditOutcome.DENIED, 401],
    [new ForbiddenException('rol sensible'), AuditOutcome.DENIED, 403],
    [new BadRequestException('entrada sensible'), AuditOutcome.FAILED, 400],
    [new Error('detalle interno sensible'), AuditOutcome.FAILED, 500],
  ] as const)(
    'clasifica la excepción sin entregarla ni usarla como responseBody: %s',
    async (exception, outcome, status) => {
      const auditService = { recordHttp: jest.fn().mockResolvedValue(undefined) };
      const requestContext = { setActor: jest.fn() };
      const adapter = {
        isHeadersSent: jest.fn().mockReturnValue(false),
        reply: jest.fn(),
        end: jest.fn(),
      };
      const filter = new AuditExceptionFilter(
        { httpAdapter: adapter } as unknown as HttpAdapterHost,
        auditService as unknown as AuditService,
        requestContext as unknown as RequestContextService,
      );
      const request = { user: { sub: ACTOR_ID } } as Partial<Request>;

      filter.catch(exception, httpHost(request, {}));
      await flushAsyncWork();

      expect(auditService.recordHttp).toHaveBeenCalledWith(request, outcome, status);
      expect(auditService.recordHttp.mock.calls[0]).toHaveLength(3);
      expect(auditService.recordHttp.mock.calls[0]).not.toContain(exception);
    },
  );
});

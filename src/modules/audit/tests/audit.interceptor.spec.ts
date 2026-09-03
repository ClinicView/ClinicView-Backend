import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import type { Request, Response } from 'express';
import { firstValueFrom, of } from 'rxjs';
import { AuditTrailInterceptor } from '../audit.interceptor';
import { AuditService } from '../audit.service';

function httpContext(request: Partial<Request>, response: Partial<Response>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditTrailInterceptor', () => {
  it('espera que la auditoría se persista antes de emitir la respuesta exitosa', async () => {
    let finishPersistence: (() => void) | undefined;
    const pendingPersistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const auditService = {
      recordHttp: jest.fn().mockReturnValue(pendingPersistence),
    };
    const interceptor = new AuditTrailInterceptor(auditService as unknown as AuditService);
    const request = { method: 'GET' } as Partial<Request>;
    const response = { statusCode: 206 } as Partial<Response>;
    const responseBody = { data: ['resultado seguro'] };
    const next = { handle: jest.fn(() => of(responseBody)) } as CallHandler;
    let emitted = false;

    const resultPromise = firstValueFrom(
      interceptor.intercept(httpContext(request, response), next),
    ).then((result) => {
      emitted = true;
      return result;
    });

    await Promise.resolve();
    expect(auditService.recordHttp).toHaveBeenCalledWith(
      request,
      AuditOutcome.SUCCESS,
      206,
      responseBody,
    );
    expect(emitted).toBe(false);

    if (!finishPersistence) throw new Error('No se inicializó la promesa diferida.');
    finishPersistence();

    await expect(resultPromise).resolves.toBe(responseBody);
    expect(emitted).toBe(true);
  });

  it('propaga un fallo inesperado de la capa de auditoría', async () => {
    const auditService = {
      recordHttp: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    };
    const interceptor = new AuditTrailInterceptor(auditService as unknown as AuditService);
    const next = { handle: jest.fn(() => of({ ok: true })) } as CallHandler;

    await expect(
      firstValueFrom(
        interceptor.intercept(httpContext({ method: 'GET' }, { statusCode: 200 }), next),
      ),
    ).rejects.toThrow('audit unavailable');
  });

  it('no audita transportes que no son HTTP', async () => {
    const auditService = { recordHttp: jest.fn() };
    const interceptor = new AuditTrailInterceptor(auditService as unknown as AuditService);
    const next = { handle: jest.fn(() => of('rpc-result')) } as CallHandler;
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(firstValueFrom(interceptor.intercept(context, next))).resolves.toBe('rpc-result');
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(auditService.recordHttp).not.toHaveBeenCalled();
  });
});

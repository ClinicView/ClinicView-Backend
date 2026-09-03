import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService } from '../../../core/request-context/request-context.service';
import { AuditContextGuard } from '../audit-context.guard';
import { AUDIT_POLICY_KEY, type AuditPolicy, SKIP_AUDIT_KEY } from '../audit.decorator';

class ExampleController {
  findOne(): void {}
}

function httpContext(request: Partial<Request>): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => ExampleController,
    getHandler: () => ExampleController.prototype.findOne,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditContextGuard', () => {
  afterEach(() => {
    Reflect.deleteMetadata(AUDIT_POLICY_KEY, ExampleController.prototype.findOne);
    Reflect.deleteMetadata(SKIP_AUDIT_KEY, ExampleController.prototype.findOne);
    Reflect.deleteMetadata(AUDIT_POLICY_KEY, ExampleController);
    Reflect.deleteMetadata(SKIP_AUDIT_KEY, ExampleController);
  });

  it('propaga la política y SkipAudit con una ruta estática segura', () => {
    const policy: AuditPolicy = {
      action: 'PATIENT_VIEWED',
      resourceType: 'PATIENT',
      patientParam: 'id',
    };
    Reflect.defineMetadata(AUDIT_POLICY_KEY, policy, ExampleController.prototype.findOne);
    Reflect.defineMetadata(SKIP_AUDIT_KEY, true, ExampleController.prototype.findOne);
    const requestContext = { setAuditPolicy: jest.fn() };
    const guard = new AuditContextGuard(
      new Reflector(),
      requestContext as unknown as RequestContextService,
    );
    const request = {
      method: 'get',
      route: { path: '/patients/:id' },
    } as Partial<Request> & Record<string, unknown>;
    Object.defineProperty(request, 'originalUrl', {
      get: () => {
        throw new Error('La auditoría no debe leer originalUrl');
      },
    });

    expect(guard.canActivate(httpContext(request))).toBe(true);
    expect(requestContext.setAuditPolicy).toHaveBeenCalledWith(policy, '/patients/:id', true);
  });

  it('crea una política HTTP fallback y usa controlador.método si no hay ruta segura', () => {
    const requestContext = { setAuditPolicy: jest.fn() };
    const guard = new AuditContextGuard(
      new Reflector(),
      requestContext as unknown as RequestContextService,
    );

    expect(
      guard.canActivate(
        httpContext({
          method: 'patch',
          route: { path: '/patients/:id?include=documentNumber' },
        } as Partial<Request>),
      ),
    ).toBe(true);

    expect(requestContext.setAuditPolicy).toHaveBeenCalledWith(
      { action: 'HTTP_PATCH' },
      'ExampleController.findOne',
      false,
    );
  });

  it('usa el fallback si la ruta excede el máximo permitido', () => {
    const requestContext = { setAuditPolicy: jest.fn() };
    const guard = new AuditContextGuard(
      new Reflector(),
      requestContext as unknown as RequestContextService,
    );

    guard.canActivate(
      httpContext({
        method: 'get',
        route: { path: `/${'a'.repeat(160)}` },
      } as Partial<Request>),
    );

    expect(requestContext.setAuditPolicy).toHaveBeenCalledWith(
      { action: 'HTTP_GET' },
      'ExampleController.findOne',
      false,
    );
  });

  it('no toca el contexto para transportes no HTTP', () => {
    const requestContext = { setAuditPolicy: jest.fn() };
    const reflector = { getAllAndOverride: jest.fn() };
    const guard = new AuditContextGuard(
      reflector as unknown as Reflector,
      requestContext as unknown as RequestContextService,
    );
    const context = { getType: () => 'rpc' } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(requestContext.setAuditPolicy).not.toHaveBeenCalled();
  });
});

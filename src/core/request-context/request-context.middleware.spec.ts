import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RequestContextService, type RequestContextState } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';

const VALID_REQUEST_ID = '4b98f7dd-8cd8-4f51-876d-a972d98ec678';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function execute(
  middleware: RequestContextMiddleware,
  requestContext: RequestContextService,
  request: Partial<Request>,
): {
  state: RequestContextState;
  setHeader: jest.Mock;
  next: jest.Mock;
} {
  let state: RequestContextState | undefined;
  const setHeader = jest.fn();
  const next = jest.fn(() => {
    const current = requestContext.get();
    state = current ? { ...current } : undefined;
  });

  middleware.use(request as Request, { setHeader } as unknown as Response, next);

  if (!state) throw new Error('El middleware no inicializó el contexto de solicitud.');
  return { state, setHeader, next };
}

describe('RequestContextMiddleware', () => {
  it('conserva un X-Request-Id UUID válido y lo devuelve en la respuesta', () => {
    const requestContext = new RequestContextService();
    const middleware = new RequestContextMiddleware(
      requestContext,
      config({ 'audit.hashSecret': 'test-audit-secret', nodeEnv: 'test' }),
    );

    const { state, setHeader, next } = execute(middleware, requestContext, {
      headers: { 'x-request-id': VALID_REQUEST_ID },
      method: 'get',
      socket: { remoteAddress: undefined } as Request['socket'],
    });

    expect(state.requestId).toBe(VALID_REQUEST_ID);
    expect(state.method).toBe('GET');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', VALID_REQUEST_ID);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    'no-es-un-uuid',
    '../../patients?documentNumber=87654321',
    '00000000-0000-0000-0000-000000000000',
  ])('regenera un UUID seguro cuando el identificador entrante es inválido: %s', (incoming) => {
    const requestContext = new RequestContextService();
    const middleware = new RequestContextMiddleware(
      requestContext,
      config({ 'audit.hashSecret': 'test-audit-secret', nodeEnv: 'test' }),
    );

    const { state, setHeader } = execute(middleware, requestContext, {
      headers: { 'x-request-id': incoming },
      method: 'post',
      socket: { remoteAddress: undefined } as Request['socket'],
    });

    expect(state.requestId).not.toBe(incoming);
    expect(state.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', state.requestId);
  });

  it('persiste solo HMAC de IP y user-agent, nunca los valores crudos', () => {
    const hashSecret = 'a-secret-known-only-by-the-server';
    const rawIp = '203.0.113.47';
    const rawUserAgent = 'Clinic Terminal / patient-87654321';
    const requestContext = new RequestContextService();
    const middleware = new RequestContextMiddleware(
      requestContext,
      config({ 'audit.hashSecret': hashSecret, nodeEnv: 'test' }),
    );

    const { state } = execute(middleware, requestContext, {
      headers: { 'user-agent': rawUserAgent },
      ip: rawIp,
      method: 'get',
      socket: { remoteAddress: '10.0.0.10' } as Request['socket'],
    });

    expect(state.ipHash).toBe(createHmac('sha256', hashSecret).update(rawIp).digest('hex'));
    expect(state.userAgentHash).toBe(
      createHmac('sha256', hashSecret).update(rawUserAgent).digest('hex'),
    );
    expect(state.ipHash).toHaveLength(64);
    expect(state.userAgentHash).toHaveLength(64);
    expect(JSON.stringify(state)).not.toContain(rawIp);
    expect(JSON.stringify(state)).not.toContain(rawUserAgent);
  });

  it('deja hashes nulos cuando la solicitud no aporta esos datos', () => {
    const requestContext = new RequestContextService();
    const middleware = new RequestContextMiddleware(
      requestContext,
      config({ 'audit.hashSecret': 'test-audit-secret', nodeEnv: 'test' }),
    );

    const { state } = execute(middleware, requestContext, {
      headers: {},
      method: 'get',
      socket: { remoteAddress: undefined } as Request['socket'],
    });

    expect(state.ipHash).toBeNull();
    expect(state.userAgentHash).toBeNull();
  });

  it.each([undefined, '', '   ', 'too-short'])(
    'rechaza iniciar en producción sin un AUDIT_HASH_SECRET robusto: %p',
    (hashSecret) => {
      expect(
        () =>
          new RequestContextMiddleware(
            new RequestContextService(),
            config({ 'audit.hashSecret': hashSecret, nodeEnv: 'production' }),
          ),
      ).toThrow('AUDIT_HASH_SECRET must contain at least 32 characters in production.');
    },
  );

  it('acepta en producción un AUDIT_HASH_SECRET de al menos 32 caracteres', () => {
    expect(
      () =>
        new RequestContextMiddleware(
          new RequestContextService(),
          config({ 'audit.hashSecret': 'x'.repeat(32), nodeEnv: 'production' }),
        ),
    ).not.toThrow();
  });
});

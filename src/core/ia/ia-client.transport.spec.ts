import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import { IaClientService } from './ia-client.service';

const payload = JSON.stringify({ ocr: { text: 'Texto sintético' }, entities: [] });

describe('IA process HTTP transport (real local sockets, no OCR)', () => {
  let server: Server;
  let service: IaClientService;
  let requests: number;

  async function setup(
    timeout: number,
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ) {
    requests = 0;
    server = createServer((request, response) => {
      requests += 1;
      request.resume();
      handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    service = new IaClientService({
      get: (key: string, fallback?: unknown) =>
        key === 'ia.internalUrl'
          ? `http://127.0.0.1:${port}`
          : key === 'ia.processTimeoutMs'
            ? timeout
            : fallback,
    } as unknown as ConfigService);
  }

  const process = () =>
    service.process('synthetic_document', Buffer.from('synthetic'), 'application/pdf');

  afterEach(async () => {
    jest.restoreAllMocks();
    await service?.onModuleDestroy();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('sets bounded headers/body/total budgets, independent of the native 300 s defaults', async () => {
    await setup(1800000, (_request, response) => response.end(payload));
    const dispatch = jest.spyOn(Agent.prototype, 'dispatch');
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await expect(process()).resolves.toMatchObject({ ocrText: 'Texto sintético' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/v1/process',
        headersTimeout: 1800000,
        bodyTimeout: 1800000,
        idempotent: false,
        signal: expect.any(AbortSignal),
      }),
      expect.anything(),
    );
    expect(timeout).toHaveBeenCalledWith(1800000);
    expect(requests).toBe(1);
  });

  it.each(['headers', 'body'])('accepts delayed %s within the configured budget', async (phase) => {
    await setup(1000, (_request, response) => {
      if (phase === 'body') {
        response.writeHead(200);
        response.flushHeaders();
      }
      const timer = setTimeout(() => response.end(payload), 120);
      response.on('close', () => clearTimeout(timer));
    });
    await expect(process()).resolves.toMatchObject({ ocrText: 'Texto sintético' });
    expect(requests).toBe(1);
  });

  it.each(['headers', 'body'])(
    'aborts stalled %s at the total budget without another POST',
    async (phase) => {
      await setup(100, (_request, response) => {
        if (phase === 'body') {
          response.writeHead(200);
          response.flushHeaders();
        }
        // No server response until after this test's allowed request budget.
      });
      const started = Date.now();
      await expect(process()).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(1500);
      expect(requests).toBe(1);
    },
  );

  it('enforces the total deadline even when body chunks continue arriving', async () => {
    await setup(150, (_request, response) => {
      response.writeHead(200);
      response.flushHeaders();
      const timer = setInterval(() => response.write(' '), 20);
      response.on('close', () => clearInterval(timer));
    });
    const started = Date.now();
    await expect(process()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(requests).toBe(1);
  });

  it.each([302, 503])('does not follow/replay an OCR POST on HTTP %s', async (status) => {
    await setup(1000, (_request, response) => {
      response.writeHead(status, { Location: '/must-not-be-called' });
      response.end(JSON.stringify({ detail: 'Respuesta sintética' }));
    });
    await expect(process()).rejects.toThrow(`status ${status}`);
    expect(requests).toBe(1);
  });

  it('does not retry a disconnected non-idempotent OCR POST', async () => {
    await setup(1000, (request) => request.socket.destroy());
    await expect(process()).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it('releases the private agent and aborts a pending request on module shutdown', async () => {
    let received: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    await setup(1800000, () => received());
    const pending = process();
    const rejected = expect(pending).rejects.toThrow();
    await arrived;
    await service.onModuleDestroy();
    await rejected;
    expect(requests).toBe(1);
    await expect(process()).rejects.toThrow();
  });

  it.each([0, -1, Infinity, Number.NaN, 7200001])(
    'rejects unbounded or invalid timeout %s',
    (timeout) => {
      expect(
        () =>
          new IaClientService({
            get: (key: string, fallback?: unknown) =>
              key === 'ia.processTimeoutMs' ? timeout : fallback,
          } as unknown as ConfigService),
      ).toThrow('bounded duration');
    },
  );
});

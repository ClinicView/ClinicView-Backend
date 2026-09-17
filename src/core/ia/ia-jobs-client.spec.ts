import { createHash } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import { IaClientService } from './ia-client.service';
import {
  assertIaJobIdentity,
  IaJobHttpError,
  IaJobProtocolError,
  parseIaJobStatus,
} from './ia-job.types';

const jobId = '6ca2b1db-2222-4000-8000-111111111111';
const runId = '7ca2b1db-2222-4000-8000-111111111111';
const documentId = 'document_synthetic';
const file = Buffer.from('synthetic content only');
const sha256 = createHash('sha256').update(file).digest('hex');
const key = 'synthetic-private-key-longer-than-32-characters';
function status() {
  return {
    jobId,
    documentId,
    sourceSha256: sha256,
    status: 'QUEUED',
    attempt: 1,
    processingRunId: null,
    createdAt: '2026-09-17T12:00:00Z',
    updatedAt: '2026-09-17T12:00:00Z',
    startedAt: null,
    completedAt: null,
    heartbeatAt: null,
    progress: {
      phase: 'QUEUED',
      currentPage: null,
      pagesTotal: null,
      pagesCompleted: 0,
      linesTotal: null,
      linesCompleted: 0,
      batchesTotal: null,
      batchesCompleted: 0,
    },
    error: null,
  };
}
function result() {
  return {
    documentId,
    processingRunId: runId,
    ocr: {
      text: 'Synthetic',
      pages: [
        {
          page: 1,
          width: 100,
          height: 100,
          coordinateSpace: 'preprocessed_page',
          lines: [{ lineId: 'line_1', text: 'Synthetic', bbox: [0, 0, 30, 10] }],
        },
      ],
    },
    entities: [],
    confidence: { overall: 0.6, level: 'MEDIUM' },
    metrics: { cer: null, estimated: true },
  };
}

describe('IA durable jobs private HTTP client', () => {
  let server: Server | undefined;
  let service: IaClientService | undefined;
  let requests: number;
  async function setup(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
    values: Record<string, unknown> = {},
  ) {
    requests = 0;
    server = createServer((request, response) => {
      requests += 1;
      handler(request, response);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const config: Record<string, unknown> = {
      'ia.internalUrl': `http://127.0.0.1:${port}`,
      'ia.internalApiKey': key,
      ...values,
    };
    service = new IaClientService({
      get: (name: string, fallback?: unknown) =>
        Object.prototype.hasOwnProperty.call(config, name) ? config[name] : fallback,
    } as unknown as ConfigService);
  }
  function json(response: ServerResponse, body: unknown, code = 200) {
    response.writeHead(code, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }
  afterEach(async () => {
    jest.restoreAllMocks();
    await service?.onModuleDestroy();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    service = undefined;
    server = undefined;
  });

  it('submits once using fixed endpoint, internal authentication, bounded deadline and immutable hash', async () => {
    let received: unknown;
    await setup((request, response) => {
      expect(request.url).toBe(`/v1/jobs/${jobId}`);
      expect(request.method).toBe('POST');
      expect(request.headers['x-ia-internal-key']).toBe(key);
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        received = JSON.parse(body);
        json(response, status(), 202);
      });
    });
    const dispatch = jest.spyOn(Agent.prototype, 'dispatch');
    await expect(
      service!.submitJob(jobId, documentId, sha256, file, 'application/pdf'),
    ).resolves.toMatchObject(status());
    expect(received).toEqual({
      documentId,
      sourceSha256: sha256,
      mimeType: 'application/pdf',
      fileRef: `data:application/pdf;base64,${file.toString('base64')}`,
      options: { language: 'es', withEntities: true },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotent: false,
        headersTimeout: 15000,
        bodyTimeout: 15000,
        signal: expect.any(AbortSignal),
      }),
      expect.anything(),
    );
    expect(requests).toBe(1);
  });

  it('fetches the stable status and normalized spatial result without another POST', async () => {
    await setup((request, response) => {
      request.resume();
      expect(request.method).toBe('GET');
      json(response, request.url?.endsWith('/result') ? result() : status());
    });
    await expect(service!.getJob(jobId)).resolves.toMatchObject({
      jobId,
      documentId,
      sourceSha256: sha256,
    });
    await expect(service!.getJobResult(jobId)).resolves.toMatchObject({
      documentId,
      processingRunId: runId,
      ocrText: 'Synthetic',
      layout: { runId, pages: [{ page: 1 }] },
    });
    expect(requests).toBe(2);
  });

  it.each([undefined, '', 'too-short'])(
    'fails closed without an internal secret (%s)',
    async (secret) => {
      await setup((_request, response) => json(response, status()), {
        'ia.internalApiKey': secret,
      });
      await expect(service!.getJob(jobId)).rejects.toThrow('not configured');
      expect(requests).toBe(0);
    },
  );

  it.each(['../secret', jobId.toUpperCase(), 'not-a-uuid'])(
    'rejects unsafe job identifier %s before HTTP',
    async (id) => {
      await setup((_request, response) => json(response, status()));
      await expect(service!.getJob(id)).rejects.toBeInstanceOf(IaJobProtocolError);
      expect(requests).toBe(0);
    },
  );

  it('rejects mutated bytes and oversized uploads before dispatch', async () => {
    await setup((_request, response) => json(response, status()));
    await expect(
      service!.submitJob(jobId, documentId, sha256, Buffer.from('changed'), 'application/pdf'),
    ).rejects.toThrow();
    await expect(
      service!.submitJob(
        jobId,
        documentId,
        sha256,
        Buffer.alloc(20 * 1024 * 1024 + 1),
        'application/pdf',
      ),
    ).rejects.toThrow();
    expect(requests).toBe(0);
  });

  it.each(['documentId', 'sourceSha256', 'jobId'])(
    'rejects mismatched submitted identity %s',
    async (field) => {
      await setup((request, response) => {
        request.resume();
        json(response, {
          ...status(),
          [field]: field === 'sourceSha256' ? '0'.repeat(64) : 'wrong',
        });
      });
      await expect(
        service!.submitJob(jobId, documentId, sha256, file, 'application/pdf'),
      ).rejects.toBeInstanceOf(IaJobProtocolError);
      expect(requests).toBe(1);
    },
  );

  it.each([302, 401, 404, 409, 429, 503])(
    'exposes HTTP %s without body content, redirect or replay',
    async (code) => {
      await setup((request, response) => {
        request.resume();
        response.setHeader('Location', '/must-not-follow');
        json(response, { detail: 'PRIVATE SENTINEL' }, code);
      });
      await expect(service!.getJob(jobId)).rejects.toMatchObject({
        statusCode: code,
        message: `IA job request failed with HTTP ${code}.`,
      });
      expect(requests).toBe(1);
      expect(new IaJobHttpError(code)).toBeInstanceOf(Error);
    },
  );

  it.each(['content-type', 'too-large', 'chunked-limit', 'invalid-json'])(
    'rejects invalid or unbounded response %s',
    async (scenario) => {
      await setup((request, response) => {
        request.resume();
        response.writeHead(200, {
          'Content-Type': scenario === 'content-type' ? 'text/html' : 'application/json',
          ...(scenario === 'too-large' ? { 'Content-Length': '70000' } : {}),
        });
        response.end(scenario === 'chunked-limit' ? ' '.repeat(70000) : '{ invalid');
      });
      await expect(service!.getJob(jobId)).rejects.toBeInstanceOf(IaJobProtocolError);
    },
  );

  it('aborts a stalled request without resubmitting and does not expose payloads', async () => {
    await setup((request) => request.resume(), { 'ia.jobTimeoutMs': 100 });
    const start = Date.now();
    await expect(
      service!.submitJob(jobId, documentId, sha256, file, 'application/pdf'),
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1500);
    expect(requests).toBe(1);
  });

  it('does not replay a disconnected submission', async () => {
    await setup((request) => request.socket.destroy());
    await expect(
      service!.submitJob(jobId, documentId, sha256, file, 'application/pdf'),
    ).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it('enforces the total deadline even when a status body keeps producing chunks', async () => {
    await setup(
      (request, response) => {
        request.resume();
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.flushHeaders();
        const timer = setInterval(() => response.write(' '), 20);
        response.on('close', () => clearInterval(timer));
      },
      { 'ia.jobTimeoutMs': 120 },
    );
    const start = Date.now();
    await expect(service!.getJob(jobId)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1500);
    expect(requests).toBe(1);
  });

  it('aborts pending job requests when the module shuts down', async () => {
    let arrived: () => void = () => undefined;
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await setup((request) => {
      request.resume();
      arrived();
    });
    const pending = service!.getJob(jobId);
    const rejected = expect(pending).rejects.toThrow();
    await received;
    await service!.onModuleDestroy();
    await rejected;
    expect(requests).toBe(1);
  });

  it.each(['identity', 'run', 'text', 'confidence', 'entities', 'metrics', 'geometry'])(
    'rejects malformed job result %s',
    async (kind) => {
      const payload = result() as Record<string, unknown>;
      if (kind === 'identity') payload.documentId = '../../escape';
      if (kind === 'run') payload.processingRunId = 'not-uuid';
      if (kind === 'text') payload.ocr = { text: 42, pages: [] };
      if (kind === 'confidence') payload.confidence = { overall: 3, level: 'HIGH' };
      if (kind === 'entities')
        payload.entities = [{ type: 'UNKNOWN', value: 'x', confidence: 0.5 }];
      if (kind === 'metrics') payload.metrics = { estimated: 'false' };
      if (kind === 'geometry') payload.ocr = { text: 'x', pages: [{ page: 1, lines: [] }] };
      await setup((request, response) => {
        request.resume();
        json(response, payload);
      });
      await expect(service!.getJobResult(jobId)).rejects.toBeInstanceOf(IaJobProtocolError);
    },
  );
});

describe('IA job status validation', () => {
  it.each([0, -1, Infinity, Number.NaN, 60001])('rejects an invalid job timeout %s', (timeout) => {
    expect(
      () =>
        new IaClientService({
          get: (name: string, fallback?: unknown) =>
            name === 'ia.jobTimeoutMs' ? timeout : fallback,
        } as unknown as ConfigService),
    ).toThrow('bounded duration');
  });

  it.each([
    { progress: { ...status().progress, linesCompleted: -1 } },
    { progress: { ...status().progress, linesTotal: 2, linesCompleted: 3 } },
    { progress: { ...status().progress, linesCompleted: 0.5 } },
    { progress: { ...status().progress, pagesTotal: 1, currentPage: 2 } },
    { progress: { ...status().progress, phase: 'INVENTED' } },
    { status: 'INVENTED' },
    { attempt: 2 },
    { createdAt: 'no-date' },
    { status: 'SUCCEEDED' },
    { processingRunId: 'invalid' },
  ])('rejects malformed status %j', (patch) => {
    expect(() => parseIaJobStatus({ ...status(), ...patch }, jobId)).toThrow(IaJobProtocolError);
  });

  it('preserves only allowlisted metadata and sanitizes worker error text', () => {
    const parsed = parseIaJobStatus(
      {
        ...status(),
        status: 'INTERRUPTED',
        completedAt: '2026-09-17T12:10:00Z',
        error: { code: 'WORKER_RESTARTED', message: 'PRIVATE SENTINEL', retryable: true },
        clinicalText: 'PRIVATE SENTINEL',
      },
      jobId,
    );
    expect(parsed.error).toMatchObject({ code: 'WORKER_RESTARTED', retryable: true });
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE SENTINEL');
    expect(() => assertIaJobIdentity(parsed, documentId, sha256)).not.toThrow();
    expect(() => assertIaJobIdentity(parsed, 'other-document', sha256)).toThrow(IaJobProtocolError);
  });
});

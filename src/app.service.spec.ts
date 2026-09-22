import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { StorageService } from './core/storage/storage.service';

describe('readiness, without clinical data or inference', () => {
  let query: jest.Mock, storage: jest.Mock, request: jest.SpyInstance;
  const settings: Record<string, unknown> = {};
  let service: AppService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ value: 1 }]);
    storage = jest.fn().mockResolvedValue(undefined);
    request = jest.spyOn(global, 'fetch');
    service = new AppService(
      { $queryRaw: query } as unknown as PrismaService,
      { checkReady: storage } as unknown as StorageService,
      { get: (key: string, fallback: unknown) => settings[key] ?? fallback } as ConfigService,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const key of Object.keys(settings)) delete settings[key];
  });
  it('liveness does not touch dependencies', () => {
    expect(service.getHealth().status).toBe('ok');
    expect(query).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('probes SELECT 1 and storage, skips IA by default, coalesces/caches requests', async () => {
    const [first, second] = await Promise.all([service.getReady(), service.getReady()]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'ready',
      checks: { database: 'ok', storage: 'ok', ia: 'skipped' },
    });
    await service.getReady();
    expect(query).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0][0]).toBe('SELECT 1');
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['database', 'storage'])(
    'fails closed on %s without returning paths/errors',
    async (name) => {
      (name === 'database' ? query : storage).mockRejectedValue(
        new Error('postgres://SENSITIVE/private-patient'),
      );
      const result = await service.getReady();
      expect(result.status).toBe('not_ready');
      expect(result.checks[name as 'database' | 'storage']).toBe('unavailable');
      expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|private-patient|postgres/);
    },
  );
  it('bounds latency and does not multiply an unresolved database probe', async () => {
    jest.useFakeTimers();
    settings['health.timeoutMs'] = 250;
    let finish: () => void = () => undefined;
    query.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = service.getReady();
    await jest.advanceTimersByTimeAsync(251);
    expect((await first).status).toBe('not_ready');
    await jest.advanceTimersByTimeAsync(5001);
    const next = service.getReady();
    await jest.advanceTimersByTimeAsync(251);
    await next;
    expect(query).toHaveBeenCalledTimes(1);
    finish();
  });
  it('checks only authenticated /ready when IA is opted in; never /process', async () => {
    settings['health.requireIa'] = true;
    settings['ia.internalUrl'] = 'http://unit-ia:8000';
    settings['ia.internalApiKey'] = 'unit-internal-key-32-characters-long';
    request.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready', checks: {} }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect((await service.getReady()).checks.ia).toBe('ok');
    expect(request).toHaveBeenCalledWith(
      'http://unit-ia:8000/ready',
      expect.objectContaining({
        redirect: 'error',
        headers: {
          'X-IA-Internal-Key': settings['ia.internalApiKey'],
          Accept: 'application/json',
        },
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['not_ready', 'invalid-json', 'oversized', 'http-error'])(
    'rejects unsafe IA response %s',
    async (mode) => {
      settings['health.requireIa'] = true;
      settings['ia.internalApiKey'] = 'unit-internal-key-32-characters-long';
      const body =
        mode === 'invalid-json'
          ? '<html>SENSITIVE</html>'
          : mode === 'oversized'
            ? 'x'.repeat(9000)
            : '{"status":"not_ready"}';
      request.mockResolvedValue(
        new Response(body, {
          status: mode === 'http-error' ? 503 : 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const result = await service.getReady();
      expect(result.checks.ia).toBe('unavailable');
      expect(result.status).toBe('not_ready');
      expect(JSON.stringify(result)).not.toContain('SENSITIVE');
    },
  );
});

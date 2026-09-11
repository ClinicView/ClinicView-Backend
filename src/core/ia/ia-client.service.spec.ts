import { ConfigService } from '@nestjs/config';
import { IaClientService } from './ia-client.service';

describe('IaClientService private page artifacts', () => {
  const originalFetch = global.fetch;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]);
  let request: jest.Mock;
  let service: IaClientService;
  const values: Record<string, unknown> = {
    'ia.internalUrl': 'http://127.0.0.1:8000',
    'ia.internalApiKey': 'synthetic-internal-key',
  };
  beforeEach(() => {
    request = jest.fn();
    global.fetch = request;
    service = new IaClientService({
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    } as unknown as ConfigService);
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    global.fetch = originalFetch;
    delete values['ia.maxPageImageBytes'];
  });

  it('uses the fixed internal endpoint/key, abort signal and rejects redirects', async () => {
    request.mockResolvedValue(new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    await expect(service.getPageImage('doc_1', 'run_1', 1)).resolves.toEqual(png);
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1/artifacts/doc_1/run_1/pages/1/image',
      expect.objectContaining({
        redirect: 'error',
        headers: { 'X-IA-Internal-Key': 'synthetic-internal-key' },
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    ['../escape', 'run_1', 1],
    ['doc_1', '../../private', 1],
    ['doc_1', 'run_1', 0],
  ])('rejects untrusted artifact identifiers before network access', async (doc, run, page) => {
    await expect(
      service.getPageImage(doc as string, run as string, page as number),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects mislabeled image data and non-PNG content types', async () => {
    request.mockResolvedValueOnce(
      new Response('not a png', { headers: { 'Content-Type': 'image/png' } }),
    );
    await expect(service.getPageImage('doc', 'run', 1)).rejects.toThrow('not a PNG');
    request.mockResolvedValueOnce(new Response(png, { headers: { 'Content-Type': 'text/html' } }));
    await expect(service.getPageImage('doc', 'run', 1)).rejects.toThrow('unavailable');
  });
  it('enforces the streaming size limit without trusting Content-Length', async () => {
    values['ia.maxPageImageBytes'] = 20;
    request.mockResolvedValue(new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    await expect(service.getPageImage('doc', 'run', 1)).rejects.toThrow('allowed size');
  });
});

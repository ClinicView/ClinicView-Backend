import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { setupApp } from './app.setup';

describe('HTTP setup security defaults', () => {
  const originalEnv = process.env;
  let set: jest.Mock, cors: jest.Mock, createDocument: jest.SpyInstance, swagger: jest.SpyInstance;
  let app: INestApplication;
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.TRUST_PROXY_HOPS;
    set = jest.fn();
    cors = jest.fn();
    createDocument = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue({ openapi: '3.0.0', info: { title: 'unit', version: '1' }, paths: {} });
    swagger = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    app = {
      setGlobalPrefix: jest.fn(),
      use: jest.fn(),
      useGlobalPipes: jest.fn(),
      enableCors: cors,
      getHttpAdapter: () => ({ getInstance: () => ({ set }) }),
    } as unknown as INestApplication;
  });
  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });
  it('does not trust forwarded IP headers by default and retains the harness disable option', () => {
    setupApp(app, { enableSwagger: false });
    expect(set).toHaveBeenCalledWith('trust proxy', 0);
    expect(swagger).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });
  it('permits exactly one explicitly trusted hop and an exact normalized CORS origin', () => {
    process.env.TRUST_PROXY_HOPS = '1';
    process.env.FRONTEND_URL = 'https://clinic.example.test/';
    setupApp(app, { enableSwagger: false });
    expect(set).toHaveBeenCalledWith('trust proxy', 1);
    expect(cors).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://clinic.example.test', credentials: true }),
    );
  });
  it('never publishes Swagger in production, even if a caller requests it', () => {
    process.env.NODE_ENV = 'production';
    setupApp(app, { enableSwagger: true });
    expect(swagger).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });
  it('keeps development Swagger available', () => {
    setupApp(app);
    expect(swagger).toHaveBeenCalledTimes(1);
  });
  it('rejects broad proxy trust before attaching middleware', () => {
    process.env.TRUST_PROXY_HOPS = 'true';
    expect(() => setupApp(app)).toThrow('TRUST_PROXY_HOPS');
    expect(app.use).not.toHaveBeenCalled();
  });
});

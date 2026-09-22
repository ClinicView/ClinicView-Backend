import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './database/prisma.service';
import { StorageService } from './core/storage/storage.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback: unknown) => fallback },
        },
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
        {
          provide: StorageService,
          useValue: { checkReady: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('getHealth', () => {
    it('should return status ok', () => {
      const result = appController.getHealth();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });
  });

  it('returns ready only after successful dependency probes', async () => {
    await expect(appController.getReady()).resolves.toMatchObject({ status: 'ready' });
  });

  it('maps unavailable dependencies to HTTP 503 with a sanitized body', async () => {
    const result = {
      status: 'not_ready' as const,
      timestamp: 'synthetic',
      checks: {
        database: 'unavailable' as const,
        storage: 'ok' as const,
        ia: 'skipped' as const,
      },
    };
    const controller = new AppController({ getReady: async () => result } as unknown as AppService);
    await expect(controller.getReady()).rejects.toMatchObject({ status: 503, response: result });
  });
});

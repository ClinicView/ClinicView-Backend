import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './database/prisma.service';
import { StorageService } from './core/storage/storage.service';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  version: string;
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: {
    database: 'ok' | 'unavailable';
    storage: 'ok' | 'unavailable';
    ia: 'ok' | 'unavailable' | 'skipped';
  };
}

@Injectable()
export class AppService {
  private cached?: { expiresAt: number; response: ReadinessResponse };
  private checking?: Promise<ReadinessResponse>;
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  getHealth(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }

  getReady(): Promise<ReadinessResponse> {
    if (this.cached && this.cached.expiresAt > Date.now())
      return Promise.resolve(this.cached.response);
    if (this.checking) return this.checking;
    this.checking = this.inspectReady()
      .then((response) => {
        this.cached = { response, expiresAt: Date.now() + 5000 };
        return response;
      })
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }

  private async inspectReady(): Promise<ReadinessResponse> {
    const requireIa = this.config.get<boolean>('health.requireIa', false);
    const [database, storage, ia] = await Promise.all([
      this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.probe('storage', () => this.storage.checkReady()),
      requireIa ? this.probe('ia', () => this.checkIa()) : Promise.resolve(true),
    ]);
    return {
      status: database && storage && ia ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: database ? 'ok' : 'unavailable',
        storage: storage ? 'ok' : 'unavailable',
        ia: requireIa ? (ia ? 'ok' : 'unavailable') : 'skipped',
      },
    };
  }

  /** Timeouts bound HTTP latency; a pending native probe is reused, never multiplied. */
  private async probe(name: string, operation: () => Promise<unknown>): Promise<boolean> {
    let active = this.pending.get(name);
    if (!active) {
      active = Promise.resolve()
        .then(operation)
        .then(
          () => true,
          () => false,
        )
        .finally(() => {
          this.pending.delete(name);
        });
      this.pending.set(name, active);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        active,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(
            () => resolve(false),
            this.config.get<number>('health.timeoutMs', 3000),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async checkIa(): Promise<void> {
    const base = this.config.get<string>('ia.internalUrl', 'http://ia:8000').replace(/\/$/, '');
    const key = this.config.get<string>('ia.internalApiKey');
    if (!key || key.length < 32) throw new Error('Dependency unavailable.');
    const response = await fetch(`${base}/ready`, {
      headers: { 'X-IA-Internal-Key': key, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(this.config.get<number>('health.timeoutMs', 3000)),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Dependency unavailable.');
    try {
      if (
        !response.ok ||
        response.headers.get('content-type')?.split(';')[0] !== 'application/json'
      )
        throw new Error('Dependency unavailable.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) throw new Error('Dependency unavailable.');
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { status?: unknown };
      if (!data || data.status !== 'ready') throw new Error('Dependency unavailable.');
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

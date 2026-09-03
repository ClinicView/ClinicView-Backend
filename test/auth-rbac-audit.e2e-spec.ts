import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditOutcome, PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import {
  AuthRbacFixture,
  createAuthRbacFixture,
  E2E_SENTINELS,
  E2eIdentity,
} from './fixtures/auth-rbac.fixture';
import { cookieFrom, jsonHeaders, jsonRequest } from './support/http-client';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface LoginResult {
  accessToken: string;
  cookie: string;
  response: Response;
  body: TokenResponse;
}

describe('Auth, RBAC y auditoría append-only (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let prisma: PrismaClient;
  let fixture: AuthRbacFixture;
  let baseUrl: string;
  let adminAccessToken: string;
  let adminRefreshCookie: string;
  let dashboardAccessToken: string;
  let dashboardRefreshCookie: string;
  let limitedAccessToken: string;

  async function login(identity: E2eIdentity): Promise<LoginResult> {
    const { response, body } = await jsonRequest<TokenResponse>(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: identity.email,
        password: identity.password,
        rememberMe: false,
      }),
    });
    expect(response.status).toBe(200);
    return {
      accessToken: body.access_token,
      cookie: cookieFrom(response),
      response,
      body,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    fixture = await createAuthRbacFixture(prisma);

    moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ logger: false });
    setupApp(app, { enableSwagger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('entrega el refresh exclusivamente en una cookie HttpOnly', async () => {
    const loginResult = await login(fixture.admin);
    adminAccessToken = loginResult.accessToken;
    adminRefreshCookie = loginResult.cookie;

    const setCookie = loginResult.response.headers.get('set-cookie') ?? '';
    const rawRefreshToken = decodeURIComponent(adminRefreshCookie.split('=', 2)[1]);
    expect(adminAccessToken).toEqual(expect.any(String));
    expect(loginResult.body.token_type).toBe('Bearer');
    expect(loginResult.body.refresh_token).toBeUndefined();
    expect(JSON.stringify(loginResult.body)).not.toContain(rawRefreshToken);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/i);
    expect(loginResult.response.headers.get('cache-control')).toContain('no-store');
    expect(loginResult.response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('rechaza credenciales incorrectas sin filtrar el secreto', async () => {
    const denied = await jsonRequest<unknown>(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: fixture.admin.email,
        password: E2E_SENTINELS.badPassword,
      }),
    });
    expect(denied.response.status).toBe(401);
    expect(JSON.stringify(denied.body)).not.toContain(E2E_SENTINELS.badPassword);
  });

  it('rota el refresh token y rechaza la reproducción del token consumido', async () => {
    const rotated = await jsonRequest<TokenResponse>(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { ...jsonHeaders(), Cookie: adminRefreshCookie },
    });
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.access_token).toEqual(expect.any(String));
    const rotatedCookie = cookieFrom(rotated.response);
    expect(rotatedCookie).not.toBe(adminRefreshCookie);

    const replay = await jsonRequest<unknown>(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { ...jsonHeaders(), Cookie: adminRefreshCookie },
    });
    expect(replay.response.status).toBe(401);
    expect(replay.response.headers.get('set-cookie')).toMatch(/Max-Age=0|Expires=/i);

    adminAccessToken = rotated.body.access_token;
    adminRefreshCookie = rotatedCookie;
  });

  it('revoca la cookie al cerrar sesión y mantiene logout idempotente', async () => {
    const limitedLogin = await login(fixture.limited);
    limitedAccessToken = limitedLogin.accessToken;

    const logout = await jsonRequest<unknown>(baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: { ...jsonHeaders(), Cookie: limitedLogin.cookie },
    });
    expect(logout.response.status).toBe(204);
    expect(logout.response.headers.get('set-cookie')).toMatch(/Max-Age=0|Expires=/i);

    const replay = await jsonRequest<unknown>(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { ...jsonHeaders(), Cookie: limitedLogin.cookie },
    });
    expect(replay.response.status).toBe(401);

    const secondLogout = await jsonRequest<unknown>(baseUrl, '/api/auth/logout', {
      method: 'POST',
      headers: jsonHeaders(),
    });
    expect(secondLogout.response.status).toBe(204);
  });

  it('aplica todos los permisos requeridos por el dashboard', async () => {
    const dashboardLogin = await login(fixture.dashboard);
    dashboardAccessToken = dashboardLogin.accessToken;
    dashboardRefreshCookie = dashboardLogin.cookie;

    const allowed = await jsonRequest<{ patientsToday: number }>(baseUrl, '/api/dashboard/stats', {
      headers: jsonHeaders(dashboardAccessToken),
    });
    expect(allowed.response.status).toBe(200);
    expect(allowed.body.patientsToday).toBe(0);

    const denied = await jsonRequest<unknown>(baseUrl, '/api/dashboard/stats', {
      headers: jsonHeaders(limitedAccessToken),
    });
    expect(denied.response.status).toBe(403);
  });

  it('restringe la bitácora a admin.audit.read y no persiste entradas del request', async () => {
    const denied = await jsonRequest<unknown>(baseUrl, '/api/audit/events', {
      headers: jsonHeaders(dashboardAccessToken),
    });
    expect(denied.response.status).toBe(403);

    const rejectedQuery = await jsonRequest<unknown>(
      baseUrl,
      `/api/audit/events?limit=100&pii=${encodeURIComponent(E2E_SENTINELS.query)}`,
      { headers: jsonHeaders(adminAccessToken) },
    );
    expect(rejectedQuery.response.status).toBe(400);

    const allowed = await jsonRequest<{
      data: Array<{ action: string }>;
      nextCursor: string | null;
    }>(baseUrl, '/api/audit/events?limit=100', { headers: jsonHeaders(adminAccessToken) });
    expect(allowed.response.status).toBe(200);
    expect(Array.isArray(allowed.body.data)).toBe(true);
    expect(allowed.body.data.length).toBeGreaterThan(0);
    expect(allowed.response.headers.get('cache-control')).toContain('no-store');
  });

  it('revoca de inmediato access y refresh al cambiar el rol', async () => {
    const roleChange = await jsonRequest<unknown>(
      baseUrl,
      `/api/users/${fixture.dashboard.id}/role`,
      {
        method: 'PATCH',
        headers: jsonHeaders(adminAccessToken),
        body: JSON.stringify({ roleKey: fixture.limitedRoleKey }),
      },
    );
    expect(roleChange.response.status).toBe(200);

    const staleAccess = await jsonRequest<unknown>(baseUrl, '/api/dashboard/stats', {
      headers: jsonHeaders(dashboardAccessToken),
    });
    expect(staleAccess.response.status).toBe(401);

    const staleRefresh = await jsonRequest<unknown>(baseUrl, '/api/auth/refresh', {
      method: 'POST',
      headers: { ...jsonHeaders(), Cookie: dashboardRefreshCookie },
    });
    expect(staleRefresh.response.status).toBe(401);

    const currentSession = await login(fixture.dashboard);
    const currentPermissions = await jsonRequest<unknown>(baseUrl, '/api/dashboard/stats', {
      headers: jsonHeaders(currentSession.accessToken),
    });
    expect(currentPermissions.response.status).toBe(403);
  });

  it('omite sentinelas PII y rechaza UPDATE, DELETE y TRUNCATE del log', async () => {
    const auditEvents = await prisma.auditEvent.findMany();
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(
      auditEvents.some(
        (event) => event.action === 'DASHBOARD_VIEWED' && event.outcome === AuditOutcome.DENIED,
      ),
    ).toBe(true);
    expect(
      auditEvents.some(
        (event) => event.action === 'AUDIT_EVENTS_VIEWED' && event.outcome === AuditOutcome.SUCCESS,
      ),
    ).toBe(true);
    expect(
      auditEvents.some(
        (event) => event.action === 'AUTH_LOGIN' && event.outcome === AuditOutcome.DENIED,
      ),
    ).toBe(true);

    const serializedAudit = JSON.stringify(auditEvents);
    for (const sentinel of Object.values(E2E_SENTINELS)) {
      expect(serializedAudit).not.toContain(sentinel);
    }

    const firstEvent = auditEvents[0];
    const countBefore = await prisma.auditEvent.count();
    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE "audit_events" SET "action" = $1 WHERE "id" = $2::uuid',
        'TAMPERED',
        firstEvent.id,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "audit_events" WHERE "id" = $1::uuid', firstEvent.id),
    ).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_events"')).rejects.toThrow();

    expect(await prisma.auditEvent.count()).toBe(countBefore);
    expect((await prisma.auditEvent.findUnique({ where: { id: firstEvent.id } }))?.action).not.toBe(
      'TAMPERED',
    );
  });
});

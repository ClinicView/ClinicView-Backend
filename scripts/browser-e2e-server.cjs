'use strict';

/**
 * Dedicated real Nest HTTP server for the frontend browser/PDF acceptance suite.
 * Only IA is an external controlled double. Auth, RBAC, DB transactions, jobs,
 * private images, immutable review and export endpoints are production code.
 */
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const { join, resolve } = require('node:path');
const {
  BROWSER_DATABASE,
  assertSafeBrowserDatabaseUrl,
  assertSafeBrowserRunDir,
  assertBrowserServiceOrigins,
} = require('./browser-e2e-safety.cjs');

const PROJECT_ROOT = resolve(__dirname, '..');
const PORT = 3101;
// Fixed SQL, deliberately not derived from input, shared with no other E2E suite.
const DROP_BROWSER_SCHEMA = 'DROP SCHEMA IF EXISTS "clinicview_browser_e2e" CASCADE';
const CREATE_BROWSER_SCHEMA = 'CREATE SCHEMA "clinicview_browser_e2e"';
const LOCK_NAMESPACE = 1827400151;
const LOCK_ID = 3101;

let app;
let prisma;
let stopping = false;
let runDir;
let privateDirectoryValidated = false;
let stage = 'safety';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolvePromise);
  });
  return server;
}

async function assertPrivateRunDirectory(directory) {
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Run directory must be a real existing directory.');
  const actual = await fs.realpath(directory);
  // Windows os.tmpdir() may contain a legitimate 8.3 user alias. Resolve it
  // before constructing private output paths; never delete the runtime folder.
  assertSafeBrowserRunDir(actual);
  for (const name of ['backend-manifest.json', 'backend-manifest.json.tmp', 'uploads']) {
    try {
      await fs.lstat(join(directory, name));
      throw new Error(`Run directory already contains ${name}; use a fresh directory.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return actual;
}

async function seedFixtures() {
  const bcrypt = require('bcrypt');
  const password = () => `Browser-${randomBytes(20).toString('base64url')}!`;
  const adminPassword = password();
  const adminEmail = 'browser.admin@clinicview.invalid';
  // Reuse the same source-of-truth RBAC seed as production, without duplicating capabilities.
  execFileSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', join(PROJECT_ROOT, 'prisma/seed.ts')],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ADMIN_EMAIL: adminEmail,
        ADMIN_PASSWORD: adminPassword,
        ADMIN_USERNAME: 'browser_admin',
        ADMIN_FULL_NAME: 'Administrador E2E Sintetico',
      },
      stdio: 'pipe',
      timeout: 60_000,
      windowsHide: true,
    },
  );
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const doctorRole = await prisma.role.findUniqueOrThrow({ where: { key: 'MEDICO' } });
  const readerPermissions = await prisma.permission.findMany({
    where: { key: { in: ['patients.read', 'records.read', 'documents.read'] } },
  });
  if (readerPermissions.length !== 3)
    throw new Error('Production seed did not provide browser reader permissions.');
  const readerRole = await prisma.role.create({
    data: {
      key: 'BROWSER_E2E_READER',
      name: 'Lector E2E',
      rolePermissions: { create: readerPermissions.map((entry) => ({ permissionId: entry.id })) },
    },
  });
  async function identity(roleId, suffix, firstName, lastName) {
    const secret = password();
    const user = await prisma.user.create({
      data: {
        email: `browser.${suffix}@clinicview.invalid`,
        username: `browser_${suffix}`,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        profession: 'Medicina general',
        passwordHash: await bcrypt.hash(secret, 10),
        userRoles: { create: { roleId } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      password: secret,
    };
  }
  const doctor = await identity(doctorRole.id, 'doctor', 'Elena', 'Medina E2E');
  const reader = await identity(readerRole.id, 'reader', 'Lector', 'E2E');
  const patient = await prisma.patient.create({
    data: {
      documentType: 'DNI',
      documentNumber: '90000001',
      firstName: 'Lucia',
      lastName: 'Salazar E2E',
      dateOfBirth: new Date('1990-03-12T00:00:00.000Z'),
      sex: 'F',
      medicalRecordNumber: 'BROWSER-E2E-001',
      email: 'paciente.sintetico@clinicview.invalid',
      address: 'Direccion sintetica para pruebas',
      createdBy: admin.id,
    },
  });
  const catalogs = [];
  for (const kind of ['SERVICE', 'SPECIALTY']) {
    catalogs.push(
      await prisma.clinicalCatalogEntry.create({
        data: {
          kind,
          code: `BROWSER_${kind}`,
          name: 'Medicina general E2E',
          normalizedName: 'medicina general e2e',
          updatedBy: admin.id,
        },
      }),
    );
  }
  return {
    admin: {
      id: admin.id,
      email: admin.email,
      username: admin.username,
      fullName: admin.fullName,
      password: adminPassword,
    },
    doctor,
    reader,
    patient,
    catalogs,
  };
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(exitCode || 1), 10_000);
  deadline.unref();
  try {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect(); // releases the session-level advisory lock
  } finally {
    clearTimeout(deadline);
    process.exitCode = exitCode;
    if (process.connected) process.disconnect();
  }
}

async function main() {
  const databaseUrl = assertSafeBrowserDatabaseUrl();
  runDir = assertSafeBrowserRunDir();
  assertBrowserServiceOrigins();
  runDir = await assertPrivateRunDirectory(runDir);
  privateDirectoryValidated = true;
  stage = 'port reservation';
  const reservation = await reservePort();
  try {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      PORT: String(PORT),
      UPLOAD_DIR: join(runDir, 'uploads'),
      OCR_JOBS_WORKER_ENABLED: 'true',
      TS_NODE_PROJECT: join(PROJECT_ROOT, 'tsconfig.json'),
      JWT_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      AUDIT_HASH_SECRET: randomBytes(48).toString('hex'),
      JWT_EXPIRES_IN: '1h',
      JWT_REFRESH_EXPIRES_IN: '1h',
      JWT_REFRESH_SESSION_EXPIRES_IN: '1h',
    });
    stage = 'database isolation and lock';
    const { PrismaClient } = require('@prisma/client');
    // A single private connection retains the advisory lock for the whole run.
    const lockUrl = new URL(databaseUrl);
    lockUrl.searchParams.set('connection_limit', '1');
    prisma = new PrismaClient({ datasources: { db: { url: lockUrl.toString() } } });
    await prisma.$connect();
    const [identity] =
      await prisma.$queryRaw`SELECT current_database() AS name, inet_server_port() AS port`;
    if (identity.name !== BROWSER_DATABASE || identity.port !== 5433)
      throw new Error('Connected database identity is not the isolated browser test database.');
    const [lock] =
      await prisma.$queryRaw`SELECT pg_try_advisory_lock(${LOCK_NAMESPACE}::integer, ${LOCK_ID}::integer) AS acquired`;
    if (!lock.acquired)
      throw new Error('Another browser E2E run already owns the isolated test schema.');
    await prisma.$executeRawUnsafe(DROP_BROWSER_SCHEMA);
    await prisma.$executeRawUnsafe(CREATE_BROWSER_SCHEMA);
    stage = 'migration';
    execFileSync(
      process.execPath,
      [join(PROJECT_ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: 'pipe',
        timeout: 120_000,
        windowsHide: true,
      },
    );
    stage = 'synthetic fixture seed';
    const fixtures = await seedFixtures();
    await fs.mkdir(process.env.UPLOAD_DIR, { mode: 0o700 });
    stage = 'real application startup';
    require('ts-node/register/transpile-only');
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require(join(PROJECT_ROOT, 'src/app.module.ts'));
    const { setupApp } = require(join(PROJECT_ROOT, 'src/app.setup.ts'));
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    setupApp(app, { enableSwagger: false });
    await new Promise((resolvePromise) => reservation.close(resolvePromise));
    await app.listen(PORT, '127.0.0.1');
    stage = 'private manifest';
    const manifest = {
      schemaVersion: 1,
      ready: true,
      synthetic: true,
      pid: process.pid,
      // Same host as the frontend: exercise the real SameSite session cookie.
      backendUrl: `http://localhost:${PORT}`,
      frontendUrl: process.env.FRONTEND_URL,
      createdAt: new Date().toISOString(),
      ...fixtures,
    };
    await fs.writeFile(
      join(runDir, 'backend-manifest.json.tmp'),
      JSON.stringify(manifest, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    await fs.rename(
      join(runDir, 'backend-manifest.json.tmp'),
      join(runDir, 'backend-manifest.json'),
    );
    console.log('[browser-e2e] Real backend ready on 127.0.0.1:3101; private manifest written.');
    if (process.send) process.send({ ready: true });
  } catch (error) {
    reservation.close();
    throw error;
  }
}

function requestShutdown() {
  // Install before migrations/startup so a parent that disappears early cannot
  // leave an orphan Nest listener. Synchronous migration/seed children have
  // already completed before Node can deliver the disconnect callback.
  if (!stopping)
    void shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
}

process.once('SIGINT', requestShutdown);
process.once('SIGTERM', requestShutdown);
process.on('message', (message) => {
  if (message === 'shutdown' || message?.type === 'shutdown') requestShutdown();
});
process.once('disconnect', requestShutdown);

main().catch(async (error) => {
  // Never dump child-process environments, connection URLs or credential-bearing manifests.
  console.error(
    `[browser-e2e] Backend setup failed at ${stage}. Inspect the private error report.`,
  );
  if (runDir && privateDirectoryValidated) {
    const details =
      error instanceof Error
        ? { stage, name: error.name, code: error.code ?? null, message: error.message }
        : { stage, name: 'UnknownError' };
    await fs
      .writeFile(join(runDir, 'backend-error.json'), JSON.stringify(details), { mode: 0o600 })
      .catch(() => {});
  }
  await shutdown(1);
});

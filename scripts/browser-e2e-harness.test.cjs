'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createWriteStream } = require('node:fs');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { assertSafeBrowserDatabaseUrl } = require('./browser-e2e-safety.cjs');

test(
  'real browser harness seeds isolated RBAC and shuts down through IPC',
  {
    skip: !process.env.BROWSER_E2E_DATABASE_URL,
    timeout: 150_000,
  },
  async () => {
    const databaseUrl = assertSafeBrowserDatabaseUrl();
    const runDir = await mkdtemp(join(tmpdir(), 'clinicview-browser-e2e-harness-'));
    const log = createWriteStream(join(runDir, 'backend.log'), { mode: 0o600 });
    const child = fork(join(__dirname, 'browser-e2e-server.cjs'), [], {
      cwd: join(__dirname, '..'),
      env: {
        ...process.env,
        BROWSER_E2E_DATABASE_URL: databaseUrl,
        BROWSER_E2E_RUN_DIR: runDir,
        FRONTEND_URL: 'http://localhost:3110',
        IA_INTERNAL_URL: 'http://127.0.0.1:8100',
        IA_INTERNAL_API_KEY: randomBytes(32).toString('hex'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let stopObserved;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Harness startup timed out; private artifacts: ${runDir}`)),
          120_000,
        );
        child.once('message', (message) => {
          clearTimeout(timer);
          if (message?.ready) resolve();
          else reject(new Error('Harness did not signal readiness.'));
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`Harness exited before readiness; private artifacts: ${runDir}`));
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      const manifest = JSON.parse(await readFile(join(runDir, 'backend-manifest.json'), 'utf8'));
      assert.equal(manifest.synthetic, true);
      assert.equal(manifest.ready, true);
      assert.equal(manifest.pid, child.pid);
      assert.equal(manifest.backendUrl, 'http://localhost:3101');
      const health = await fetch(`${manifest.backendUrl}/api/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, 'ok');
      const unauthenticated = await fetch(
        `${manifest.backendUrl}/api/patients/${manifest.patient.id}`,
      );
      assert.equal(unauthenticated.status, 401);
      for (const [identity, canManageUsers] of [
        [manifest.admin, true],
        [manifest.doctor, false],
        [manifest.reader, false],
      ]) {
        const login = await fetch(`${manifest.backendUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: manifest.frontendUrl },
          body: JSON.stringify({
            email: identity.email,
            password: identity.password,
            rememberMe: false,
          }),
        });
        assert.equal(login.status, 200);
        const token = (await login.json()).access_token;
        assert.equal(typeof token, 'string');
        const headers = { Authorization: `Bearer ${token}` };
        const patient = await fetch(`${manifest.backendUrl}/api/patients/${manifest.patient.id}`, {
          headers,
        });
        assert.equal(patient.status, 200);
        assert.equal((await patient.json()).medicalRecordNumber, 'BROWSER-E2E-001');
        const administration = await fetch(`${manifest.backendUrl}/api/users`, { headers });
        assert.equal(administration.status, canManageUsers ? 200 : 403);
      }
      stopObserved = once(child, 'exit');
      child.send('shutdown');
      const [code] = await stopObserved;
      assert.equal(code, 0);
      assert.equal(child.connected, false);
      assert.ok(runDir.includes('clinicview-browser-e2e-'));
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        if (child.connected) child.send('shutdown');
        const timer = setTimeout(() => child.kill(), 10_000);
        await (stopObserved ?? once(child, 'exit'));
        clearTimeout(timer);
      }
      log.end();
    }
  },
);

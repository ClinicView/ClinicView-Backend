'use strict';

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { assertSafeE2eDatabaseUrl } = require('./e2e-database-url');

let databaseUrl;
try {
  databaseUrl = assertSafeE2eDatabaseUrl();
} catch (error) {
  console.error(`[e2e safety] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const projectRoot = resolve(__dirname, '..');
const jestBin = resolve(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
const result = spawnSync(
  process.execPath,
  [jestBin, '--config', './test/jest-e2e.json', '--runInBand', ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:3000',
      JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-access-secret-clinicview-only',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'e2e-refresh-secret-clinicview-only',
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '15m',
      JWT_REFRESH_SESSION_EXPIRES_IN: process.env.JWT_REFRESH_SESSION_EXPIRES_IN ?? '1h',
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? '1h',
      AUDIT_HASH_SECRET: process.env.AUDIT_HASH_SECRET ?? 'e2e-audit-hmac-secret-clinicview-only',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`[e2e runner] ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

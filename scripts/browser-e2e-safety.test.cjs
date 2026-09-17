'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  assertSafeBrowserDatabaseUrl,
  assertSafeBrowserRunDir,
  assertBrowserServiceOrigins,
} = require('./browser-e2e-safety.cjs');

const SAFE_URL =
  'postgresql://postgres@127.0.0.1:5433/clinicview_test?schema=clinicview_browser_e2e';

test('accepts only the explicit local browser test namespace', () => {
  assert.equal(assertSafeBrowserDatabaseUrl(SAFE_URL), SAFE_URL);
  const localhost = SAFE_URL.replace('127.0.0.1', 'localhost').replace('postgresql:', 'postgres:');
  assert.equal(assertSafeBrowserDatabaseUrl(localhost), localhost);
});

for (const [reason, value] of [
  ['missing URL', ''],
  ['invalid URL', 'not a database'],
  ['development database', SAFE_URL.replace('clinicview_test', 'clinicview_dev')],
  ['arbitrary database', SAFE_URL.replace('clinicview_test', 'other_test')],
  ['default port', SAFE_URL.replace(':5433', '')],
  ['system PostgreSQL port', SAFE_URL.replace(':5433', ':5432')],
  ['remote hostname', SAFE_URL.replace('127.0.0.1', 'db.example.com')],
  ['hostname suffix', SAFE_URL.replace('127.0.0.1', 'localhost.example.com')],
  ['other protocol', SAFE_URL.replace('postgresql:', 'https:')],
  ['public schema', SAFE_URL.replace('clinicview_browser_e2e', 'public')],
  ['other E2E schema', SAFE_URL.replace('clinicview_browser_e2e', 'clinicview_e2e')],
  ['missing schema', SAFE_URL.split('?')[0]],
  ['duplicated schema', `${SAFE_URL}&schema=public`],
  ['duplicated same schema', `${SAFE_URL}&schema=clinicview_browser_e2e`],
  ['search_path injection', `${SAFE_URL}&options=-c%20search_path%3Dpublic`],
  ['host override', `${SAFE_URL}&host=production`],
  ['fragment', `${SAFE_URL}#schema=public`],
  ['encoded database', SAFE_URL.replace('/clinicview_test', '/%63linicview_test')],
  ['extra path', SAFE_URL.replace('/clinicview_test', '/clinicview_test/public')],
  ['no user', SAFE_URL.replace('postgres@', '')],
]) {
  test(`refuses ${reason} before connecting or resetting`, () => {
    assert.throws(() => assertSafeBrowserDatabaseUrl(value));
  });
}

test('does not read DATABASE_URL when the browser variable is absent', () => {
  const previousBrowser = process.env.BROWSER_E2E_DATABASE_URL;
  const previousDatabase = process.env.DATABASE_URL;
  delete process.env.BROWSER_E2E_DATABASE_URL;
  process.env.DATABASE_URL = SAFE_URL;
  try {
    assert.throws(() => assertSafeBrowserDatabaseUrl());
  } finally {
    if (previousBrowser === undefined) delete process.env.BROWSER_E2E_DATABASE_URL;
    else process.env.BROWSER_E2E_DATABASE_URL = previousBrowser;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});

test('restricts runtime artifacts to a uniquely named absolute directory', () => {
  const path = join(tmpdir(), 'clinicview-browser-e2e-test123');
  assert.equal(assertSafeBrowserRunDir(path), path);
  for (const bad of [
    '',
    '.',
    tmpdir(),
    join(tmpdir(), 'uploads'),
    'clinicview-browser-e2e-relative',
  ]) {
    assert.throws(() => assertSafeBrowserRunDir(bad));
  }
});

test('isolates browser and IA origins and requires an internal credential', () => {
  const env = {
    FRONTEND_URL: 'http://localhost:3110',
    IA_INTERNAL_URL: 'http://127.0.0.1:8100',
    IA_INTERNAL_API_KEY: 'synthetic-browser-test-key-32-characters',
  };
  assert.doesNotThrow(() => assertBrowserServiceOrigins(env));
  assert.throws(() =>
    assertBrowserServiceOrigins({ ...env, FRONTEND_URL: 'http://localhost:3002' }),
  );
  assert.throws(() =>
    assertBrowserServiceOrigins({ ...env, FRONTEND_URL: 'http://localhost:3100' }),
  );
  assert.throws(() =>
    assertBrowserServiceOrigins({ ...env, IA_INTERNAL_URL: 'http://127.0.0.1:8000' }),
  );
  assert.throws(() => assertBrowserServiceOrigins({ ...env, IA_INTERNAL_API_KEY: 'short' }));
});

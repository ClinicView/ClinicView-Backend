'use strict';

const { basename, isAbsolute, resolve } = require('node:path');

const BROWSER_SCHEMA = 'clinicview_browser_e2e';
const BROWSER_DATABASE = 'clinicview_test';

/** No fallback to DATABASE_URL and no arbitrary connection/search_path options. */
function assertSafeBrowserDatabaseUrl(value = process.env.BROWSER_E2E_DATABASE_URL) {
  let url;
  try {
    if (typeof value !== 'string' || !value) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error('BROWSER_E2E_DATABASE_URL must be an explicit PostgreSQL test URL.');
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== `/${BROWSER_DATABASE}` ||
    !url.username ||
    url.hash ||
    url.searchParams.getAll('schema').length !== 1 ||
    url.searchParams.get('schema') !== BROWSER_SCHEMA ||
    [...url.searchParams.keys()].some((key) => key !== 'schema')
  ) {
    throw new Error(
      'Browser E2E requires localhost or 127.0.0.1:5433/clinicview_test?schema=clinicview_browser_e2e, without extra URL options.',
    );
  }
  return value;
}

function assertSafeBrowserRunDir(value = process.env.BROWSER_E2E_RUN_DIR) {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    !/^clinicview-browser-e2e-[a-zA-Z0-9_-]+$/.test(basename(resolve(value)))
  ) {
    throw new Error(
      'BROWSER_E2E_RUN_DIR must be an absolute, unique clinicview-browser-e2e-* directory.',
    );
  }
  return resolve(value);
}

function assertBrowserServiceOrigins(env = process.env) {
  if (env.FRONTEND_URL !== 'http://localhost:3110') {
    throw new Error('Browser E2E FRONTEND_URL must be http://localhost:3110.');
  }
  if (env.IA_INTERNAL_URL !== 'http://127.0.0.1:8100') {
    throw new Error(
      'Browser E2E IA_INTERNAL_URL must be the controlled double on http://127.0.0.1:8100.',
    );
  }
  if (!env.IA_INTERNAL_API_KEY || env.IA_INTERNAL_API_KEY.length < 32) {
    throw new Error(
      'Browser E2E requires a fresh IA_INTERNAL_API_KEY with at least 32 characters.',
    );
  }
}

module.exports = {
  BROWSER_DATABASE,
  BROWSER_SCHEMA,
  assertSafeBrowserDatabaseUrl,
  assertSafeBrowserRunDir,
  assertBrowserServiceOrigins,
};

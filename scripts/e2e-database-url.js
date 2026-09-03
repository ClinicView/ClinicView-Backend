'use strict';

const E2E_DATABASE_SCHEMA = 'clinicview_e2e';

function assertSafeE2eDatabaseUrl(value = process.env.E2E_DATABASE_URL) {
  if (!value) {
    throw new Error(
      'E2E_DATABASE_URL es obligatoria. test:e2e nunca usa DATABASE_URL como respaldo.',
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('E2E_DATABASE_URL debe ser una URL PostgreSQL válida.');
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('E2E_DATABASE_URL debe usar el protocolo postgresql:// o postgres://.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('El nombre de base de datos de E2E_DATABASE_URL no es válido.');
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('E2E_DATABASE_URL debe indicar exactamente una base de datos de pruebas.');
  }
  if (databaseName.toLowerCase() === 'clinicview_dev') {
    throw new Error('E2E_DATABASE_URL no puede apuntar a la base clinicview_dev.');
  }

  const schemaValues = parsed.searchParams.getAll('schema');
  if (schemaValues.length !== 1 || schemaValues[0] !== E2E_DATABASE_SCHEMA) {
    throw new Error(`E2E_DATABASE_URL debe incluir exactamente ?schema=${E2E_DATABASE_SCHEMA}.`);
  }

  return value;
}

module.exports = { E2E_DATABASE_SCHEMA, assertSafeE2eDatabaseUrl };

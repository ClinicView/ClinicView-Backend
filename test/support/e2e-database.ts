import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_SCHEMA } from '../../scripts/e2e-database-url';

const DROP_E2E_SCHEMA_SQL = 'DROP SCHEMA IF EXISTS "clinicview_e2e" CASCADE';

function getValidatedDatabaseUrl(): string {
  const databaseUrl = assertSafeE2eDatabaseUrl();
  if (E2E_DATABASE_SCHEMA !== 'clinicview_e2e') {
    throw new Error('El esquema E2E compilado no coincide con el literal autorizado.');
  }
  process.env.DATABASE_URL = databaseUrl;
  return databaseUrl;
}

export async function dropIsolatedE2eSchema(): Promise<void> {
  const databaseUrl = getValidatedDatabaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$connect();
    // SQL constante: nunca interpolar nombres de esquema en una operación destructiva.
    await prisma.$executeRawUnsafe(DROP_E2E_SCHEMA_SQL);
  } finally {
    await prisma.$disconnect();
  }
}

export function deployMigrationsToE2eSchema(): void {
  const databaseUrl = getValidatedDatabaseUrl();
  const projectRoot = resolve(__dirname, '..', '..');
  const prismaCli = resolve(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

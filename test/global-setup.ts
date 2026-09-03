import { deployMigrationsToE2eSchema, dropIsolatedE2eSchema } from './support/e2e-database';

export default async function globalSetup(): Promise<void> {
  await dropIsolatedE2eSchema();
  deployMigrationsToE2eSchema();
}

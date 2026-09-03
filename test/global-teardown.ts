import { dropIsolatedE2eSchema } from './support/e2e-database';

export default async function globalTeardown(): Promise<void> {
  await dropIsolatedE2eSchema();
}

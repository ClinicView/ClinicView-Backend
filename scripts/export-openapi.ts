/** Build the API contract without listening on a port or initializing modules. */
import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { createSwaggerConfig } from '../src/app.setup';

async function main() {
  // Documentation-only placeholders. This command NEVER starts an HTTP server,
  // connects to the database, runs startup cleanup jobs or reads clinical content.
  process.env.JWT_SECRET ??= 'openapi-generation-only-not-a-runtime-secret';
  process.env.JWT_REFRESH_SECRET ??= 'openapi-generation-only-not-a-refresh-secret';
  process.env.AUDIT_HASH_SECRET ??= 'openapi-generation-only-not-an-audit-secret';
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api');
    const document = SwaggerModule.createDocument(app, createSwaggerConfig());
    const target = resolve(process.argv[2] ?? 'openapi.json');
    await writeFile(target, JSON.stringify(document, null, 2), 'utf8');
    console.log(`OpenAPI contract generated: ${target}`);
  } finally { await app.close(); }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

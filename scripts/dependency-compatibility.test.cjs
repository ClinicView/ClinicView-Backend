// Regression checks for the narrowly scoped Prisma-config merge override.
// No database, .env, generated client or clinical files are read or changed.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const prismaRequire = createRequire(require.resolve('@prisma/config'));
const { deepmerge } = prismaRequire('deepmerge-ts');
const { loadConfigFromFile } = require('@prisma/config');

test('Prisma config merge preserves plain objects, arrays and source values', () => {
  const original = { migrations: { path: 'first', seed: 'node seed.js' }, tables: ['first'], enabled: true };
  const before = structuredClone(original);
  const merged = deepmerge(original, { migrations: { path: 'second' }, tables: ['second'], enabled: false });
  assert.deepEqual(merged, { migrations: { path: 'second', seed: 'node seed.js' }, tables: ['first', 'second'], enabled: false });
  assert.deepEqual(original, before);
});

test('Prisma config merge handles circular references without stack exhaustion', () => {
  const left = { name: 'first' };
  const right = { name: 'second' };
  left.self = left;
  right.self = right;
  const result = deepmerge(left, right);
  assert.equal(result.name, 'second');
  assert.equal(result.self, result);
});

test('Prisma loads a temporary config through its actual patched merger', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clinicview-prisma-config-test-'));
  try {
    writeFileSync(join(directory, 'prisma.config.mjs'),
      'export default { schema: "./schema.prisma", migrations: { path: "./migrations", seed: "node demo-seed.js" } };\n',
      { flag: 'wx' });
    const result = await loadConfigFromFile({ configRoot: directory, configFile: 'prisma.config.mjs' });
    assert.equal(result.error, undefined);
    assert.equal(result.resolvedPath, join(directory, 'prisma.config.mjs'));
    assert.equal(result.config.schema, resolve(directory, 'schema.prisma'));
    assert.equal(result.config.migrations.path, resolve(directory, 'migrations'));
    assert.equal(result.config.migrations.seed, 'node demo-seed.js');
  } finally {
    // Only the unique directory just created by this test is removed.
    rmSync(directory, { recursive: true, force: true });
  }
});

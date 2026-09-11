'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments, selectLegacyDocuments, exportCorrections } = require('./export-corrections');

const candidate = (id, spatial = 0) => ({
  id, originalName: 'synthetic.pdf', status: 'PROCESSED',
  ocrText: 'Texto sintético OCR', correctedText: 'Texto sintético corregido',
  correctedAt: '2026-09-11T12:00:00.000Z', _count: { ocrRuns: spatial },
  patient: { documentNumber: 'PRIVATE-ID-SENTINEL' },
});

test('default mode fails closed for any spatial run, with or without a review', () => {
  assert.throws(() => selectLegacyDocuments([candidate('legacy'), candidate('spatial', 1)]), /--legacy-only/);
  assert.throws(() => selectLegacyDocuments([candidate('spatial', 2)]), /No se escribió/);
});

test('explicit legacy-only excludes every spatial candidate and preserves originals', () => {
  const documents = [candidate('legacy'), candidate('spatial', 1)];
  const before = JSON.stringify(documents);
  const result = selectLegacyDocuments(documents, true);
  assert.deepEqual(result.documents.map((document) => document.id), ['legacy']);
  assert.equal(result.spatialCount, 1);
  assert.equal(JSON.stringify(documents), before);
});

test('missing/invalid provenance cannot bypass the guard even in legacy-only mode', () => {
  for (const count of [undefined, null, -1, '0', 0.5, Number.NaN]) {
    const document = { ...candidate('unknown'), _count: { ocrRuns: count } };
    assert.throws(() => selectLegacyDocuments([document], true), /verificar la procedencia/);
  }
});

test('blocked export performs no filesystem writes or directory creation', async () => {
  const calls = [];
  const prisma = { medicalDocument: { findMany: async () => [candidate('spatial', 1)] } };
  const io = { mkdirSync: () => calls.push('mkdir'), writeFileSync: () => calls.push('write') };
  await assert.rejects(exportCorrections(prisma, { legacyOnly: false, outputPath: 'unused.jsonl' }, io), /espaciales/);
  assert.deepEqual(calls, []);
});

test('export excludes direct patient identifiers and explicitly marks unverified legacy data', async () => {
  let query;
  let written;
  const prisma = { medicalDocument: { findMany: async (value) => {
    query = value;
    return [candidate('legacy'), candidate('spatial', 1)];
  } } };
  const io = { mkdirSync: () => {}, writeFileSync: (_path, contents) => { written = contents; } };
  const result = await exportCorrections(prisma, { legacyOnly: true, outputPath: 'unused.jsonl' }, io);
  assert.equal(result.exported, 1);
  assert.equal(result.excludedSpatial, 1);
  assert.equal('patient' in query.select, false);
  assert.deepEqual(query.select._count, { select: { ocrRuns: true } });
  assert.equal(written.includes('PRIVATE-ID-SENTINEL'), false);
  assert.equal(written.includes('patientCode'), false);
  const record = JSON.parse(written.trim());
  assert.equal(record.documentId, 'legacy');
  assert.equal(record.alignmentVerified, false);
  assert.equal(record.trainingReady, false);
  assert.equal(record.exportSchema, 'legacy-document-corrections-v1');
});

test('legacy-only with all spatial candidates writes no misleading line records', async () => {
  let written;
  const result = await exportCorrections(
    { medicalDocument: { findMany: async () => [candidate('spatial', 1)] } },
    { legacyOnly: true, outputPath: 'unused.jsonl' },
    { mkdirSync: () => {}, writeFileSync: (_path, contents) => { written = contents; } },
  );
  assert.equal(result.exported, 0);
  assert.equal(result.excludedSpatial, 1);
  assert.equal(written, '');
});

test('CLI accepts explicit legacy-only and a positional path without weakening default mode', () => {
  assert.equal(parseArguments([]).legacyOnly, false);
  assert.equal(parseArguments(['--legacy-only']).legacyOnly, true);
  assert.equal(parseArguments(['synthetic.jsonl', '--legacy-only']).legacyOnly, true);
  assert.match(parseArguments([]).outputPath, /ClinicView-IA-v2.*webapp_corrections_export\.jsonl$/);
});

test('CLI rejects unknown switches and ambiguous duplicate arguments', () => {
  for (const args of [['--force-spatial'], ['one', 'two'], ['--legacy-only', '--legacy-only']]) {
    assert.throws(() => parseArguments(args), /Uso:/);
  }
});

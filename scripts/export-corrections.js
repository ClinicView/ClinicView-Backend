/**
 * Exportación LEGACY de texto corregido: NO es un dataset alineado para entrenar.
 * Uso: node scripts/export-corrections.js [--legacy-only] [ruta-salida]
 * Si un candidato tiene ejecución espacial, se aborta sin escribir.
 * --legacy-only excluye explícitamente todos esos candidatos.
 * El resultado sigue siendo privado aunque ya no incluya patientCode.
 */
'use strict';

const { mkdirSync, writeFileSync } = require('fs');
const { dirname, resolve } = require('path');

const DEFAULT_OUTPUT = resolve(
  __dirname,
  '../../ClinicView-IA-v2/data/annotations/webapp_corrections_export.jsonl',
);

function parseArguments(args) {
  let legacyOnly = false;
  let outputPath;
  for (const argument of args) {
    if (argument === '--legacy-only' && !legacyOnly) {
      legacyOnly = true;
    } else if (!argument.startsWith('-') && !outputPath) {
      outputPath = resolve(argument);
    } else {
      throw new Error('Uso: node scripts/export-corrections.js [--legacy-only] [ruta-salida]');
    }
  }
  return { legacyOnly, outputPath: outputPath ?? DEFAULT_OUTPUT };
}

function selectLegacyDocuments(documents, legacyOnly = false) {
  for (const document of documents) {
    if (!Number.isSafeInteger(document._count?.ocrRuns) || document._count.ocrRuns < 0) {
      throw new Error('No se pudo verificar la procedencia OCR de todos los candidatos. No se exportó ningún archivo.');
    }
  }
  const spatialCount = documents.filter((document) => document._count.ocrRuns > 0).length;
  if (spatialCount && !legacyOnly) {
    throw new Error(
      `${spatialCount} documento(s) tienen ejecuciones OCR espaciales. ` +
      'Su texto no puede alinearse por posición con los recortes originales. ' +
      'No se escribió ni modificó ningún archivo. Usa --legacy-only para excluirlos explícitamente. ' +
      'Un export espacial requerirá runId/revisión, recortes humanos y procedencia verificada.',
    );
  }
  return {
    documents: documents.filter((document) => document._count.ocrRuns === 0),
    spatialCount,
  };
}

async function exportCorrections(prisma, options, io = { mkdirSync, writeFileSync }) {
  const candidates = await prisma.medicalDocument.findMany({
    where: { correctedText: { not: null }, ocrText: { not: null } },
    select: {
      id: true,
      originalName: true,
      ocrText: true,
      correctedText: true,
      correctedAt: true,
      status: true,
      _count: { select: { ocrRuns: true } },
    },
    orderBy: [{ correctedAt: 'asc' }, { id: 'asc' }],
  });

  // No directory creation or overwriting of an existing export before this guard.
  const selected = selectLegacyDocuments(candidates, options.legacyOnly);
  const lines = selected.documents.map((document) => JSON.stringify({
    exportSchema: 'legacy-document-corrections-v1',
    alignmentVerified: false,
    trainingReady: false,
    documentId: document.id,
    originalName: document.originalName,
    status: document.status,
    ocrText: document.ocrText,
    correctedText: document.correctedText,
    correctedAt: document.correctedAt,
  }));
  io.mkdirSync(dirname(options.outputPath), { recursive: true });
  io.writeFileSync(options.outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
  return { exported: lines.length, excludedSpatial: selected.spatialCount, outputPath: options.outputPath };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const result = await exportCorrections(prisma, options);
    console.warn(
      'ADVERTENCIA: export LEGACY sin alineación verificada. No es automáticamente apto para entrenar. ' +
      'El archivo puede contener datos personales/clínicos; no lo publiques ni lo añadas a Git.',
    );
    console.log(`Exportados ${result.exported} documentos legacy; excluidos ${result.excludedSpatial} espaciales.\n${result.outputPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falló la exportación.');
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, selectLegacyDocuments, exportCorrections };

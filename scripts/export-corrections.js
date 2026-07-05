/**
 * Exporta las correcciones humanas de documentos digitalizados para el
 * fine-tuning de TrOCR (repositorio iav2).
 *
 * Uso (desde backend/):  node scripts/export-corrections.js [ruta-salida]
 * Salida por defecto:    ../iav2/data/annotations/webapp_corrections_export.jsonl
 *
 * Cada línea del JSONL: { documentId, originalName, patientCode, ocrText,
 * correctedText, correctedAt } — solo documentos con corrección o validados.
 */
const { PrismaClient } = require('@prisma/client');
const { mkdirSync, writeFileSync } = require('fs');
const { dirname, resolve } = require('path');

const prisma = new PrismaClient();

async function main() {
  const outputPath = resolve(
    process.argv[2] ?? '../iav2/data/annotations/webapp_corrections_export.jsonl',
  );

  const documents = await prisma.medicalDocument.findMany({
    where: {
      correctedText: { not: null },
      ocrText: { not: null },
    },
    select: {
      id: true,
      originalName: true,
      ocrText: true,
      correctedText: true,
      correctedAt: true,
      status: true,
      patient: { select: { documentNumber: true } },
    },
    orderBy: { correctedAt: 'asc' },
  });

  const lines = documents.map((doc) =>
    JSON.stringify({
      documentId: doc.id,
      originalName: doc.originalName,
      patientCode: doc.patient?.documentNumber ?? null,
      status: doc.status,
      ocrText: doc.ocrText,
      correctedText: doc.correctedText,
      correctedAt: doc.correctedAt,
    }),
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
  console.log(`Exportados ${lines.length} documentos corregidos a:\n${outputPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Seed de datos de demostración: pacientes realistas con registros clínicos,
 * documentos digitalizados (PDF real en storage), texto OCR estructurado por
 * secciones, entidades NER y métricas CER/WER.
 *
 * Uso (desde backend/):  node scripts/seed-demo.js
 * Idempotente: usa upsert por (documentType, documentNumber).
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const prisma = new PrismaClient();
const UPLOAD_DIR = process.env.STORAGE_UPLOAD_DIR || './uploads';

/* ─── Generador de PDF mínimo válido (sin dependencias) ─────── */

function buildSimplePdf(title, lines) {
  const sanitize = (text) =>
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[()\\]/g, ' ');

  const contentLines = [
    'BT /F1 14 Tf 50 780 Td (' + sanitize(title) + ') Tj ET',
    ...lines.slice(0, 44).map((line, index) =>
      'BT /F1 9 Tf 50 ' + (755 - index * 16) + ' Td (' + sanitize(line).slice(0, 95) + ') Tj ET',
    ),
  ];
  const stream = contentLines.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/* ─── Datos de demostración ──────────────────────────────────── */

function daysAgo(days, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 15, 0, 0);
  return date;
}

const PATIENTS = [
  {
    documentType: 'DNI',
    documentNumber: '69784423',
    firstName: 'María Elena',
    lastName: 'López Mendoza',
    dateOfBirth: new Date('1959-03-14'),
    sex: 'F',
    phone: '994567890',
    email: 'maria.lopez59@gmail.com',
    address: 'Av. Los Cedros 456, La Molina, Lima',
    records: [
      {
        recordType: 'CONSULTATION',
        attendedAt: daysAgo(30, 11),
        summary: 'Consulta por dolor abdominal difuso de 5 meses de evolución, sensación de alza térmica, náuseas y vómitos.',
        notes: 'Se solicita ecografía abdominal completa y perfil hepático. Control en 2 semanas con resultados.',
      },
      {
        recordType: 'EVOLUTION',
        attendedAt: daysAgo(14, 9),
        summary: 'Evolución favorable tras inicio de tratamiento. Dolor abdominal disminuido, tolera dieta blanda.',
        notes: 'Continuar con omeprazol 20 mg cada 24 h. Ecografía: colelitiasis residual, se evalúa interconsulta a cirugía.',
      },
    ],
    documents: [
      {
        originalName: 'hc_lopez_mendoza_medicina_interna.pdf',
        daysAgo: 21,
        status: 'VALIDATED',
        cer: 0.052, wer: 0.081, charAccuracy: 0.948,
        nerPrecision: 0.87, nerRecall: 0.82, nerF1: 0.84,
        estimated: false, ocrConfidence: 0.93, confidenceLevel: 'HIGH',
        ocrText: [
          'HISTORIA CLINICA',
          'DATOS DE IDENTIFICACION',
          'Paciente: LOPEZ MENDOZA, MARIA ELENA',
          'Edad: 67 años',
          'Sexo: Femenino',
          'Estado civil: Casada',
          'Procedencia: Ayacucho',
          'Servicio: Medicina Interna',
          'Fecha ingreso: 22/06/2026',
          'H.C. N°: 27854',
          'Medico: Dra. Raquel De la Fuente',
          'ANTECEDENTES',
          'Familiares: Padre hipertenso, madre con diabetes tipo 2.',
          'Patologicos: Diabetes mellitus insulinodependiente aprox. 1 año.',
          'Quirurgicos: Colecistectomia hace 20 años. Apendicectomia y peritonitis hace 18 años.',
          'Gineco-obstetricos: G8 P7, vivos 7, abortos 1.',
          'Alergias / medicacion actual: Niega alergias. Medicacion actual: metformina 850 mg.',
          'ANAMNESIS / ENFERMEDAD ACTUAL',
          'Tiempo de enfermedad: 5 meses',
          'Inicio y curso: Insidioso, progresivo',
          'Sintomas principales: Dolor abdominal, sensacion de alza termica, nauseas y vomitos.',
          'Relato: Paciente refiere malestar general, fiebre no cuantificada y dolor abdominal difuso desde hace 5 meses. Acudio a medico en provincia.',
          'FUNCIONES BIOLOGICAS',
          'Sed: conservada. Sueño: interrumpido. Sudor: conservado. Apetito: disminuido. Peso: disminuido. Orina y deposiciones: conservadas.',
          'EXAMEN FISICO',
          'General: Peso 48 kg, talla 1.46 m, IMC 22, T 36.8, alerta, orientada, hidratada.',
          'Cabeza/cuello: Normocefalo, pupilas fotorreactivas, movilidad conservada.',
          'Cardiovascular: PA 110/70 mmHg, FC 78/min, ritmo ritmico, ruidos cardiacos de buena intensidad.',
          'Abdomen: Plano, cicatriz mediana aprox. 8 cm, blando y depresible, RHA(+), dolor a la palpacion profunda en hipocondrio derecho.',
          'OBSERVACIONES',
          'Impresion diagnostica: 1. Colelitiasis residual. 2. Diabetes mellitus tipo 2 compensada.',
        ].join('\n'),
        entities: [
          { type: 'DIAGNOSIS', value: 'diabetes mellitus tipo 2', normalizedValue: 'Diabetes mellitus tipo 2', confidence: 0.94 },
          { type: 'DIAGNOSIS', value: 'colelitiasis residual', normalizedValue: 'Colelitiasis', confidence: 0.88 },
          { type: 'SYMPTOM', value: 'dolor abdominal', normalizedValue: 'Dolor abdominal', confidence: 0.91 },
          { type: 'SYMPTOM', value: 'nauseas y vomitos', normalizedValue: 'Náuseas y vómitos', confidence: 0.76 },
          { type: 'MEDICATION', value: 'metformina 850 mg', normalizedValue: 'Metformina 850 mg', confidence: 0.92 },
          { type: 'PROCEDURE', value: 'colecistectomia', normalizedValue: 'Colecistectomía', confidence: 0.85 },
          { type: 'CLINICAL_DATE', value: '22/06/2026', normalizedValue: '2026-06-22', confidence: 0.96 },
        ],
      },
      {
        originalName: 'hc_lopez_mendoza_control_evolucion.pdf',
        daysAgo: 7,
        status: 'PROCESSED',
        cer: 0.089, wer: 0.132, charAccuracy: 0.911,
        nerPrecision: 0.79, nerRecall: 0.74, nerF1: 0.76,
        estimated: true, ocrConfidence: 0.86, confidenceLevel: 'HIGH',
        ocrText: [
          'HISTORIA CLINICA - CONTROL',
          'DATOS DE IDENTIFICACION',
          'Paciente: LOPEZ MENDOZA, MARIA ELENA',
          'Edad: 67 años',
          'Servicio: Medicina Interna',
          'ANAMNESIS / ENFERMEDAD ACTUAL',
          'Tiempo de enfermedad: control a las 2 semanas',
          'Relato: Paciente en control, refiere disminucion del dolor abdominal, tolera dieta blanda, sin fiebre.',
          'EXAMEN FISICO',
          'General: PA 115/70, FC 72/min, afebril. Abdomen blando, dolor leve en hipocondrio derecho.',
          'OBSERVACIONES',
          'Plan: continuar omeprazol 20 mg. Interconsulta a cirugia por colelitiasis.',
        ].join('\n'),
        entities: [
          { type: 'SYMPTOM', value: 'dolor abdominal', normalizedValue: 'Dolor abdominal', confidence: 0.89 },
          { type: 'MEDICATION', value: 'omeprazol 20 mg', normalizedValue: 'Omeprazol 20 mg', confidence: 0.72 },
          { type: 'DIAGNOSIS', value: 'colelitiasis', normalizedValue: 'Colelitiasis', confidence: 0.83 },
        ],
      },
    ],
  },
  {
    documentType: 'DNI',
    documentNumber: '76543218',
    firstName: 'Robert Ian',
    lastName: 'Mendoza Ugarte',
    dateOfBirth: new Date('1998-04-22'),
    sex: 'M',
    phone: '999888777',
    email: 'robert.mendoza98@gmail.com',
    address: 'Av. Brasil 1233, Cuadra 12, Jesús María, Lima',
    records: [
      {
        recordType: 'CONSULTATION',
        attendedAt: daysAgo(45, 11),
        summary: 'Consulta externa por cefalea tensional recurrente de 3 semanas, asociada a estrés laboral.',
        notes: 'Se indica paracetamol 500 mg condicional a dolor, higiene del sueño y control en 1 mes.',
      },
      {
        recordType: 'LAB_RESULT',
        attendedAt: daysAgo(40, 8),
        summary: 'Hemograma completo y perfil lipídico dentro de rangos normales. Glucosa en ayunas 92 mg/dL.',
        notes: null,
      },
      {
        recordType: 'EVOLUTION',
        attendedAt: daysAgo(12, 16),
        summary: 'Cefalea remitida. Paciente asintomático, se da de alta de consulta externa.',
        notes: 'Recomendaciones de pausas activas y control anual.',
      },
    ],
    documents: [
      {
        originalName: 'hc_mendoza_ugarte_consulta_externa.pdf',
        daysAgo: 44,
        status: 'VALIDATED',
        cer: 0.038, wer: 0.064, charAccuracy: 0.962,
        nerPrecision: 0.9, nerRecall: 0.85, nerF1: 0.87,
        estimated: false, ocrConfidence: 0.95, confidenceLevel: 'HIGH',
        ocrText: [
          'HISTORIA CLINICA',
          'DATOS DE IDENTIFICACION',
          'Paciente: MENDOZA UGARTE, ROBERT IAN',
          'Edad: 28 años',
          'Sexo: Masculino',
          'Ocupacion: Tecnico en sistemas',
          'Servicio: Medicina General',
          'Medico: Dr. Carlos Ramirez',
          'ANTECEDENTES',
          'Familiares: Madre con hipertension arterial.',
          'Patologicos: Niega.',
          'Quirurgicos: Niega.',
          'Alergias / medicacion actual: Niega alergias conocidas.',
          'ANAMNESIS / ENFERMEDAD ACTUAL',
          'Tiempo de enfermedad: 3 semanas',
          'Inicio y curso: Insidioso, intermitente',
          'Sintomas principales: Cefalea tensional, tension cervical.',
          'Relato: Paciente refiere cefalea opresiva bilateral asociada a jornadas prolongadas frente al computador.',
          'FUNCIONES BIOLOGICAS',
          'Apetito: conservado. Sueño: disminuido por estres laboral. Orina y deposiciones: normales.',
          'EXAMEN FISICO',
          'General: Peso 72 kg, talla 1.75 m, IMC 23.5, PA 120/80 mmHg, FC 68/min.',
          'Cabeza/cuello: Contractura de musculatura cervical posterior. Sin focalidad neurologica.',
          'OBSERVACIONES',
          'Impresion diagnostica: Cefalea tensional episodica. Plan: paracetamol 500 mg condicional, higiene del sueño.',
        ].join('\n'),
        entities: [
          { type: 'DIAGNOSIS', value: 'cefalea tensional episodica', normalizedValue: 'Cefalea tensional', confidence: 0.93 },
          { type: 'SYMPTOM', value: 'cefalea opresiva bilateral', normalizedValue: 'Cefalea', confidence: 0.9 },
          { type: 'SYMPTOM', value: 'tension cervical', normalizedValue: 'Contractura cervical', confidence: 0.68 },
          { type: 'MEDICATION', value: 'paracetamol 500 mg', normalizedValue: 'Paracetamol 500 mg', confidence: 0.95 },
          { type: 'OBSERVATION', value: 'higiene del sueño', normalizedValue: null, confidence: 0.74 },
        ],
      },
    ],
  },
  {
    documentType: 'DNI',
    documentNumber: '45781236',
    firstName: 'Jorge Luis',
    lastName: 'Quispe Huamán',
    dateOfBirth: new Date('1985-11-02'),
    sex: 'M',
    phone: '987654321',
    email: 'jquispe85@hotmail.com',
    address: 'Jr. Túpac Amaru 587, Wanchaq, Cusco',
    records: [
      {
        recordType: 'CONSULTATION',
        attendedAt: daysAgo(60, 10),
        summary: 'Paciente con hipertensión arterial en tratamiento, acude a control trimestral. PA 135/85.',
        notes: 'Se ajusta losartán a 50 mg cada 12 h. Se refuerza dieta hiposódica y caminata diaria 30 min.',
      },
      {
        recordType: 'PROCEDURE',
        attendedAt: daysAgo(25, 12),
        summary: 'Electrocardiograma de control: ritmo sinusal, sin alteraciones agudas de la repolarización.',
        notes: null,
      },
    ],
    documents: [
      {
        originalName: 'hc_quispe_huaman_control_hta.pdf',
        daysAgo: 58,
        status: 'VALIDATED',
        cer: 0.071, wer: 0.108, charAccuracy: 0.929,
        nerPrecision: 0.84, nerRecall: 0.8, nerF1: 0.82,
        estimated: false, ocrConfidence: 0.9, confidenceLevel: 'HIGH',
        ocrText: [
          'HISTORIA CLINICA',
          'DATOS DE IDENTIFICACION',
          'Paciente: QUISPE HUAMAN, JORGE LUIS',
          'Edad: 40 años',
          'Sexo: Masculino',
          'Procedencia: Cusco',
          'Servicio: Cardiologia',
          'Medico: Dra. Ana Torres',
          'ANTECEDENTES',
          'Familiares: Padre fallecido por infarto agudo de miocardio a los 68 años.',
          'Patologicos: Hipertension arterial desde hace 5 años.',
          'Alergias / medicacion actual: Losartan 50 mg cada 24 h.',
          'ANAMNESIS / ENFERMEDAD ACTUAL',
          'Tiempo de enfermedad: control trimestral',
          'Relato: Paciente acude a control de hipertension arterial. Refiere cumplimiento irregular de dieta hiposodica.',
          'FUNCIONES BIOLOGICAS',
          'Apetito: conservado. Sueño: conservado. Orina: normal.',
          'EXAMEN FISICO',
          'General: Peso 82 kg, talla 1.68 m, IMC 29, PA 135/85 mmHg, FC 74/min.',
          'Cardiovascular: Ruidos cardiacos ritmicos, no soplos. Pulsos perifericos presentes.',
          'OBSERVACIONES',
          'Impresion diagnostica: Hipertension arterial en tratamiento, control subotimo. Plan: losartan 50 mg cada 12 h.',
        ].join('\n'),
        entities: [
          { type: 'DIAGNOSIS', value: 'hipertension arterial', normalizedValue: 'Hipertensión arterial', confidence: 0.96 },
          { type: 'MEDICATION', value: 'losartan 50 mg', normalizedValue: 'Losartán 50 mg', confidence: 0.91 },
          { type: 'DIAGNOSIS', value: 'infarto agudo de miocardio', normalizedValue: 'Infarto agudo de miocardio (antecedente familiar)', confidence: 0.66 },
          { type: 'OBSERVATION', value: 'dieta hiposodica', normalizedValue: null, confidence: 0.78 },
        ],
      },
      {
        originalName: 'hc_quispe_huaman_ecg_control.pdf',
        daysAgo: 24,
        status: 'PROCESSED',
        cer: 0.104, wer: 0.166, charAccuracy: 0.896,
        nerPrecision: 0.75, nerRecall: 0.7, nerF1: 0.72,
        estimated: true, ocrConfidence: 0.82, confidenceLevel: 'HIGH',
        ocrText: [
          'INFORME DE PROCEDIMIENTO',
          'DATOS DE IDENTIFICACION',
          'Paciente: QUISPE HUAMAN, JORGE LUIS',
          'Servicio: Cardiologia',
          'ANAMNESIS / ENFERMEDAD ACTUAL',
          'Relato: Control electrocardiografico de paciente hipertenso en tratamiento con losartan.',
          'EXAMEN FISICO',
          'General: PA 128/82 mmHg, FC 71/min.',
          'OBSERVACIONES',
          'ECG: ritmo sinusal, eje normal, sin alteraciones agudas de la repolarizacion. Proximo control en 3 meses.',
        ].join('\n'),
        entities: [
          { type: 'PROCEDURE', value: 'electrocardiograma', normalizedValue: 'Electrocardiograma', confidence: 0.88 },
          { type: 'MEDICATION', value: 'losartan', normalizedValue: 'Losartán', confidence: 0.79 },
        ],
      },
    ],
  },
  {
    documentType: 'DNI',
    documentNumber: '71234589',
    firstName: 'Ana Cecilia',
    lastName: 'Torres Salazar',
    dateOfBirth: new Date('1992-07-19'),
    sex: 'F',
    phone: '951753852',
    email: 'anace.torres@gmail.com',
    address: 'Calle Las Begonias 340, San Isidro, Lima',
    records: [
      {
        recordType: 'CONSULTATION',
        attendedAt: daysAgo(10, 9),
        summary: 'Primera consulta por lumbalgia mecánica de 1 semana tras esfuerzo físico. Sin signos de alarma.',
        notes: 'Ibuprofeno 400 mg cada 8 h por 5 días, calor local y ejercicios de estiramiento.',
      },
    ],
    documents: [
      {
        originalName: 'hc_torres_salazar_lumbalgia.pdf',
        daysAgo: 9,
        status: 'PROCESSED',
        cer: 0.095, wer: 0.148, charAccuracy: 0.905,
        nerPrecision: 0.77, nerRecall: 0.73, nerF1: 0.75,
        estimated: true, ocrConfidence: 0.84, confidenceLevel: 'HIGH',
        ocrText: [
          'HISTORIA CLINICA',
          'DATOS DE IDENTIFICACION',
          'Paciente: TORRES SALAZAR, ANA CECILIA',
          'Edad: 33 años',
          'Sexo: Femenino',
          'Ocupacion: Disenadora grafica',
          'Servicio: Medicina General',
          'ANTECEDENTES',
          'Patologicos: Niega.',
          'Alergias / medicacion actual: Alergia a penicilina.',
          'ANAMNESIS / ENFERMEDAD ACTUAL',
          'Tiempo de enfermedad: 1 semana',
          'Sintomas principales: Dolor lumbar mecanico tras esfuerzo fisico.',
          'Relato: Paciente refiere dolor lumbar de inicio subito tras cargar cajas en mudanza. No irradiacion, no parestesias.',
          'FUNCIONES BIOLOGICAS',
          'Conservadas.',
          'EXAMEN FISICO',
          'General: PA 110/70, FC 66/min. Columna: contractura paravertebral lumbar bilateral, Lasegue negativo.',
          'OBSERVACIONES',
          'Impresion diagnostica: Lumbalgia mecanica aguda. Plan: ibuprofeno 400 mg c/8h por 5 dias, calor local.',
        ].join('\n'),
        entities: [
          { type: 'DIAGNOSIS', value: 'lumbalgia mecanica aguda', normalizedValue: 'Lumbalgia mecánica', confidence: 0.9 },
          { type: 'SYMPTOM', value: 'dolor lumbar', normalizedValue: 'Dolor lumbar', confidence: 0.92 },
          { type: 'MEDICATION', value: 'ibuprofeno 400 mg', normalizedValue: 'Ibuprofeno 400 mg', confidence: 0.7 },
          { type: 'OBSERVATION', value: 'alergia a penicilina', normalizedValue: 'Alergia a penicilina', confidence: 0.86 },
        ],
      },
    ],
  },
];

/* ─── Seed ───────────────────────────────────────────────────── */

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.replace(/"/g, '') || 'admin@hospital.org';
  const admin = await prisma.user.findFirst({ where: { email: adminEmail } });
  const adminId = admin?.id ?? null;

  for (const patientData of PATIENTS) {
    const { records, documents, ...patientFields } = patientData;

    const patient = await prisma.patient.upsert({
      where: {
        documentType_documentNumber: {
          documentType: patientFields.documentType,
          documentNumber: patientFields.documentNumber,
        },
      },
      update: { ...patientFields, isActive: true },
      create: { ...patientFields, ...(adminId && { createdBy: adminId }) },
    });
    console.log(`Paciente: ${patient.lastName}, ${patient.firstName} (${patient.documentNumber})`);

    // Registros clínicos manuales (evitar duplicados por resumen).
    for (const record of records) {
      const exists = await prisma.clinicalRecord.findFirst({
        where: { patientId: patient.id, summary: record.summary },
      });
      if (exists) continue;
      await prisma.clinicalRecord.create({
        data: {
          patientId: patient.id,
          recordType: record.recordType,
          origin: 'MANUAL',
          status: 'ACTIVE',
          attendedAt: record.attendedAt,
          summary: record.summary,
          notes: record.notes,
          ...(adminId && { createdBy: adminId }),
        },
      });
      console.log(`  + registro ${record.recordType}`);
    }

    // Documentos digitalizados con PDF real en storage.
    for (const doc of documents) {
      const exists = await prisma.medicalDocument.findFirst({
        where: { patientId: patient.id, originalName: doc.originalName },
      });
      if (exists) continue;

      const filename = `${randomUUID()}.pdf`;
      const dir = join(UPLOAD_DIR, patient.id);
      mkdirSync(dir, { recursive: true });
      const pdfBuffer = buildSimplePdf('HISTORIA CLINICA (DEMO)', doc.ocrText.split('\n'));
      writeFileSync(join(dir, filename), pdfBuffer);

      const uploadedAt = daysAgo(doc.daysAgo, 8);
      const processedAt = daysAgo(doc.daysAgo, 9);
      const isValidated = doc.status === 'VALIDATED';

      await prisma.medicalDocument.create({
        data: {
          patientId: patient.id,
          originalName: doc.originalName,
          storagePath: `${patient.id}/${filename}`,
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          status: doc.status,
          ocrText: doc.ocrText,
          nerEntities: doc.entities,
          correctedText: isValidated ? doc.ocrText : null,
          correctedEntities: isValidated
            ? doc.entities.map(({ type, value, normalizedValue }) => ({ type, value, normalizedValue }))
            : null,
          correctedAt: isValidated ? daysAgo(doc.daysAgo - 1, 15) : null,
          correctedById: isValidated ? adminId : null,
          metrics: {
            cer: doc.cer,
            wer: doc.wer,
            charAccuracy: doc.charAccuracy,
            nerPrecision: doc.nerPrecision,
            nerRecall: doc.nerRecall,
            nerF1: doc.nerF1,
            estimated: doc.estimated,
          },
          ocrConfidence: doc.ocrConfidence,
          confidenceLevel: doc.confidenceLevel,
          createdAt: uploadedAt,
          processedAt,
          reviewedAt: isValidated ? daysAgo(doc.daysAgo - 1, 17) : null,
          reviewedBy: isValidated ? adminId : null,
          ...(adminId && { createdBy: adminId }),
        },
      });
      console.log(`  + documento ${doc.originalName} [${doc.status}]`);
    }
  }

  console.log('\nSeed de demostración completado.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

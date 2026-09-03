/**
 * Seed de demostración de ClinicView.
 *
 * Este archivo es deliberadamente independiente de `prisma/seed.ts`: no forma
 * parte del seed base y nunca debe ejecutarse en producción. Todos los datos
 * clínicos que crea son sintéticos y usan identificadores reservados.
 *
 * Requisitos de ejecución:
 *   NODE_ENV=development
 *   ALLOW_DEMO_SEED=true
 *   DEMO_MEDICO_PASSWORD=<contraseña local de 8 a 100 caracteres>
 *
 * Validación sin escribir en BD ni disco:
 *   node --env-file-if-exists=.env -r ts-node/register prisma/seed-demo.ts --validate-only
 *
 * Ejecución:
 *   node --env-file-if-exists=.env -r ts-node/register prisma/seed-demo.ts
 */
import { createHash } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import * as bcrypt from 'bcrypt';
import {
  ClinicalMediaStatus,
  DocumentType,
  Prisma,
  PrismaClient,
  RecordOrigin,
  RecordStatus,
  RecordType,
  Sex,
} from '@prisma/client';
// sharp publica una factory CommonJS y el proyecto no habilita esModuleInterop.
import sharpModule = require('sharp');
import type { SharpConstructor } from 'sharp';
import {
  CLINICAL_RECORD_SCHEMA_VERSION,
  validateClinicalRecordDetails,
} from '../src/modules/clinical-records/dto/record-details.dto';

const sharp = sharpModule as unknown as SharpConstructor;

const DEMO_USER_ID = 'c11c0001-2026-4d3e-8000-000000000001';
const DEMO_PATIENT_ID = 'c11c0001-2026-4d3e-8000-000000000002';
const DEMO_USER_EMAIL = 'medico.demo@clinicview.local';
const DEMO_USER_USERNAME = 'medico.demo';
const DEMO_USER_DOCUMENT = 'DEMO-MED-001';
const DEMO_PATIENT_DOCUMENT = 'DEMO-CV-0001';
const DEMO_CREATED_AT = new Date('2026-08-01T09:00:00-05:00');
const DEMO_UPDATED_AT = new Date('2026-08-20T17:00:00-05:00');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;

const RECORD_IDS: Record<RecordType, string> = {
  [RecordType.CONSULTATION]: 'c11c1001-2026-4d3e-8000-000000000001',
  [RecordType.LAB_RESULT]: 'c11c1001-2026-4d3e-8000-000000000002',
  [RecordType.PRESCRIPTION]: 'c11c1001-2026-4d3e-8000-000000000003',
  [RecordType.PROCEDURE]: 'c11c1001-2026-4d3e-8000-000000000004',
  [RecordType.EVOLUTION]: 'c11c1001-2026-4d3e-8000-000000000005',
  [RecordType.THERAPY_NOTE]: 'c11c1001-2026-4d3e-8000-000000000006',
  [RecordType.OTHER]: 'c11c1001-2026-4d3e-8000-000000000007',
};

interface DemoRecordFixture {
  id: string;
  recordType: RecordType;
  attendedAt: string;
  summary: string;
  notes: string;
  service: string;
  preliminaryDiagnosis: string | null;
  plan: string | null;
  priority: string;
  details: unknown;
}

const DEMO_RECORDS: readonly DemoRecordFixture[] = [
  {
    id: RECORD_IDS[RecordType.CONSULTATION],
    recordType: RecordType.CONSULTATION,
    attendedAt: '2026-08-10T09:15:00-05:00',
    summary:
      '[DEMO] Evaluación ambulatoria por molestia en tobillo derecho posterior a actividad recreativa simulada.',
    notes: 'Registro de demostración con datos sintéticos. No usar para decisiones clínicas.',
    service: 'Medicina general',
    preliminaryDiagnosis: 'Esguince leve de tobillo derecho (escenario sintético)',
    plan: 'Manejo conservador y control evolutivo dentro del escenario de demostración.',
    priority: 'NORMAL',
    details: {
      chiefComplaint: 'Dolor leve y edema en tobillo derecho desde el día anterior.',
      presentIllness:
        'Inicio posterior a caminata recreativa simulada. Tolera apoyo parcial y niega síntomas sistémicos.',
      relevantHistory:
        'Sin antecedentes relevantes declarados para este escenario completamente sintético.',
      vitalSigns: {
        systolicBloodPressure: 118,
        diastolicBloodPressure: 74,
        heartRate: 72,
        respiratoryRate: 16,
        temperatureCelsius: 36.6,
        oxygenSaturation: 98,
        weightKg: 67.4,
        heightCm: 168,
      },
      physicalExam:
        'Edema leve lateral, piel íntegra y movilidad conservada con molestia al final del rango.',
      diagnoses: [
        {
          description: 'Esguince leve de tobillo derecho (demostración)',
          code: 'S93.4',
          codeSystem: 'CIE-10 (referencia demo)',
          type: 'PRELIMINARY',
        },
      ],
      followUp: 'Control sintético en cinco días o antes si cambia el escenario de prueba.',
    },
  },
  {
    id: RECORD_IDS[RecordType.LAB_RESULT],
    recordType: RecordType.LAB_RESULT,
    attendedAt: '2026-08-11T11:40:00-05:00',
    summary: '[DEMO] Hemograma de control con valores sintéticos dentro de rangos de referencia.',
    notes: 'Resultados inventados para probar tablas, imágenes y exportación PDF.',
    service: 'Laboratorio clínico',
    preliminaryDiagnosis: null,
    plan: 'Archivar como resultado sintético de demostración.',
    priority: 'NORMAL',
    details: {
      studyName: 'Hemograma completo - DEMO',
      laboratoryName: 'Laboratorio Sintético ClinicView',
      specimen: 'Sangre venosa (muestra simulada)',
      collectedAt: '2026-08-11T08:20:00-05:00',
      issuedAt: '2026-08-11T11:30:00-05:00',
      results: [
        {
          analyte: 'Hemoglobina',
          value: '13.8',
          unit: 'g/dL',
          referenceRange: '12.0 - 16.0',
          flag: 'NORMAL',
        },
        {
          analyte: 'Leucocitos',
          value: '7.2',
          unit: '10^3/uL',
          referenceRange: '4.5 - 11.0',
          flag: 'NORMAL',
        },
        {
          analyte: 'Plaquetas',
          value: '268',
          unit: '10^3/uL',
          referenceRange: '150 - 450',
          flag: 'NORMAL',
        },
      ],
      interpretation:
        'Valores sintéticos sin alteraciones relevantes. Documento exclusivo para demostración visual.',
    },
  },
  {
    id: RECORD_IDS[RecordType.PRESCRIPTION],
    recordType: RecordType.PRESCRIPTION,
    attendedAt: '2026-08-12T10:05:00-05:00',
    summary: '[DEMO] Prescripción ilustrativa asociada al escenario clínico sintético.',
    notes: 'Medicación ficticia para demostración; no constituye indicación médica.',
    service: 'Medicina general',
    preliminaryDiagnosis: 'Dolor musculoesquelético leve (escenario sintético)',
    plan: 'Seguimiento clínico simulado.',
    priority: 'NORMAL',
    details: {
      indication: 'Manejo ilustrativo de molestia leve dentro del caso de demostración.',
      medications: [
        {
          name: 'Paracetamol - ejemplo demostrativo',
          presentation: 'Tableta',
          concentration: '500 mg',
          dose: '1 tableta',
          route: 'Vía oral',
          frequency: 'Cada 8 horas si fuera necesario (solo DEMO)',
          duration: '3 días (solo DEMO)',
          quantity: '9 tabletas',
          instructions: 'Datos sintéticos; no usar como receta ni recomendación terapéutica.',
        },
      ],
      validFrom: '2026-08-12',
      validUntil: '2026-08-15',
      nonPharmacologicalInstructions:
        'Indicaciones exclusivamente ilustrativas para validar la presentación del documento.',
    },
  },
  {
    id: RECORD_IDS[RecordType.PROCEDURE],
    recordType: RecordType.PROCEDURE,
    attendedAt: '2026-08-14T15:20:00-05:00',
    summary: '[DEMO] Curación simple simulada con registro fotográfico sintético.',
    notes:
      'La imagen adjunta es una ilustración generada localmente y no corresponde a una persona.',
    service: 'Tópico de procedimientos',
    preliminaryDiagnosis: 'Abrasión superficial en pierna derecha (escenario sintético)',
    plan: 'Control visual simulado en 48 horas.',
    priority: 'NORMAL',
    details: {
      procedureName: 'Curación simple de abrasión - DEMO',
      indication: 'Limpieza y cobertura dentro de un escenario clínico sintético.',
      bodySite: 'Región anterior de pierna derecha',
      laterality: 'RIGHT',
      consentStatus: 'DOCUMENTED',
      technique:
        'Higiene de manos, limpieza simulada, inspección ilustrativa y colocación de cobertura seca.',
      anesthesia: 'No requerida en el escenario sintético.',
      findings:
        'Área ilustrada de bordes regulares, sin secreción ni signos de alarma en la demostración.',
      complications: 'No se presentaron complicaciones en el escenario de demostración.',
      outcome: 'Procedimiento sintético completado y tolerado sin incidencias.',
      postProcedureCare:
        'Cuidados escritos exclusivamente para visualizar la estructura; no son instrucciones reales.',
    },
  },
  {
    id: RECORD_IDS[RecordType.EVOLUTION],
    recordType: RecordType.EVOLUTION,
    attendedAt: '2026-08-16T09:30:00-05:00',
    summary: '[DEMO] Evolución favorable del caso sintético, con menor dolor y edema.',
    notes: 'Seguimiento de demostración. No representa la evolución de un paciente real.',
    service: 'Medicina general',
    preliminaryDiagnosis: 'Evolución de lesión musculoesquelética sintética',
    plan: 'Continuar seguimiento funcional simulado.',
    priority: 'NORMAL',
    details: {
      evolution:
        'Disminución progresiva del dolor y del edema; marcha independiente en el escenario simulado.',
      subjective: 'Refiere mejoría aproximada del 70 % y descanso nocturno conservado.',
      objective: 'Edema mínimo, movilidad casi completa y apoyo tolerado.',
      assessment: 'Evolución favorable sin hallazgos de alarma dentro de los datos sintéticos.',
      treatmentResponse: 'Respuesta favorable a las medidas ilustrativas registradas.',
      incidents: 'Sin incidentes simulados desde la evaluación anterior.',
      followUp: 'Reevaluación funcional de demostración en una semana.',
    },
  },
  {
    id: RECORD_IDS[RecordType.THERAPY_NOTE],
    recordType: RecordType.THERAPY_NOTE,
    attendedAt: '2026-08-18T16:10:00-05:00',
    summary: '[DEMO] Sesión de terapia física con progresión funcional simulada.',
    notes: 'Mediciones y respuesta generadas para demostración visual.',
    service: 'Terapia física y rehabilitación',
    preliminaryDiagnosis: 'Recuperación funcional de tobillo derecho (demo)',
    plan: 'Continuar plan de ejercicios sintético.',
    priority: 'NORMAL',
    details: {
      discipline: 'Terapia física',
      sessionNumber: 2,
      goals: 'Recuperar movilidad y patrón de marcha dentro del escenario sintético.',
      baselineStatus: 'Dolor leve al subir escalones; marcha independiente.',
      interventions:
        'Movilidad activa, ejercicios propioceptivos de baja carga y educación simulada.',
      response:
        'Completa la sesión ilustrativa sin incremento de síntomas y mejora el control postural.',
      measurements: [
        { name: 'Dolor percibido', value: '2', unit: 'de 10' },
        { name: 'Dorsiflexión activa', value: '16', unit: 'grados' },
      ],
      homeInstructions:
        'Texto de demostración para validar el bloque de indicaciones; no aplicar clínicamente.',
      nextSessionAt: '2026-08-25T16:00:00-05:00',
    },
  },
  {
    id: RECORD_IDS[RecordType.OTHER],
    recordType: RecordType.OTHER,
    attendedAt: '2026-08-20T12:00:00-05:00',
    summary: '[DEMO] Nota de cierre del episodio sintético para probar documentos de tipo libre.',
    notes: 'Contenido completamente ficticio y delimitado como demostración.',
    service: 'Archivo clínico',
    preliminaryDiagnosis: null,
    plan: 'Sin acciones reales; episodio demo cerrado.',
    priority: 'NORMAL',
    details: {
      title: 'Constancia de cierre - DATOS SINTÉTICOS',
      category: 'Documento de demostración',
      context:
        'Nota creada para comprobar el tipo de registro libre, la línea de tiempo y la exportación.',
      content:
        'El episodio sintético se considera cerrado para fines de demostración. Ningún dato de este registro identifica a una persona ni debe emplearse para decisiones clínicas.',
    },
  },
];

interface DemoImageDefinition {
  id: string;
  attachmentId: string;
  recordId: string;
  sectionKey: string;
  originalName: string;
  storageSeed: string;
  caption: string;
  altText: string;
  width: number;
  height: number;
  svg: string;
}

const DEMO_IMAGES: readonly DemoImageDefinition[] = [
  {
    id: 'c11c2001-2026-4d3e-8000-000000000001',
    attachmentId: 'c11c3001-2026-4d3e-8000-000000000001',
    recordId: RECORD_IDS[RecordType.LAB_RESULT],
    sectionKey: 'lab-results',
    originalName: 'demo-hemograma-sintetico.png',
    storageSeed: 'clinicview-demo-lab-v1',
    caption: 'Vista sintética del hemograma de demostración.',
    altText:
      'Gráfico ilustrativo con tres resultados de laboratorio y marca visible de datos sintéticos.',
    width: 1200,
    height: 800,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#F4F7FB"/><stop offset="1" stop-color="#E6F2FF"/>
          </linearGradient>
          <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#1E40AF"/><stop offset="1" stop-color="#00C7FF"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="800" rx="36" fill="url(#bg)"/>
        <rect x="54" y="50" width="1092" height="700" rx="28" fill="#fff" stroke="#BCD7F4" stroke-width="3"/>
        <rect x="54" y="50" width="1092" height="116" rx="28" fill="#0B1026"/>
        <rect x="54" y="138" width="1092" height="28" fill="#0B1026"/>
        <text x="102" y="112" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#fff">HEMOGRAMA COMPLETO · DEMO</text>
        <text x="102" y="205" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#1E40AF">MUESTRA SIMULADA · 11 AGO 2026</text>
        <g font-family="Arial, sans-serif">
          <rect x="102" y="248" width="996" height="86" rx="16" fill="#F4F7FB"/>
          <text x="134" y="300" font-size="25" fill="#0B1026">Hemoglobina</text><text x="610" y="300" font-size="28" font-weight="700" fill="#1E40AF">13.8 g/dL</text><text x="878" y="300" font-size="20" fill="#16856B">NORMAL</text>
          <rect x="102" y="356" width="996" height="86" rx="16" fill="#F4F7FB"/>
          <text x="134" y="408" font-size="25" fill="#0B1026">Leucocitos</text><text x="610" y="408" font-size="28" font-weight="700" fill="#1E40AF">7.2 10³/µL</text><text x="878" y="408" font-size="20" fill="#16856B">NORMAL</text>
          <rect x="102" y="464" width="996" height="86" rx="16" fill="#F4F7FB"/>
          <text x="134" y="516" font-size="25" fill="#0B1026">Plaquetas</text><text x="610" y="516" font-size="28" font-weight="700" fill="#1E40AF">268 10³/µL</text><text x="878" y="516" font-size="20" fill="#16856B">NORMAL</text>
          <rect x="102" y="596" width="996" height="92" rx="18" fill="url(#accent)" opacity="0.12"/>
          <text x="600" y="652" text-anchor="middle" font-size="30" font-weight="700" fill="#0B1026">DATOS SINTÉTICOS / DEMO</text>
        </g>
      </svg>`,
  },
  {
    id: 'c11c2001-2026-4d3e-8000-000000000002',
    attachmentId: 'c11c3001-2026-4d3e-8000-000000000002',
    recordId: RECORD_IDS[RecordType.PROCEDURE],
    sectionKey: 'procedure-detail',
    originalName: 'demo-procedimiento-sintetico.png',
    storageSeed: 'clinicview-demo-procedure-v1',
    caption: 'Ilustración sintética asociada al procedimiento de demostración.',
    altText:
      'Diagrama vertical abstracto de una pierna con un marcador azul y la leyenda datos sintéticos.',
    width: 800,
    height: 1100,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100">
        <defs>
          <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#0B1026"/><stop offset="1" stop-color="#13265C"/>
          </linearGradient>
          <radialGradient id="mark" cx="50%" cy="50%" r="50%">
            <stop offset="0" stop-color="#00C7FF" stop-opacity="0.95"/><stop offset="1" stop-color="#1E40AF" stop-opacity="0.1"/>
          </radialGradient>
        </defs>
        <rect width="800" height="1100" rx="40" fill="url(#bg2)"/>
        <text x="70" y="92" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#fff">EVIDENCIA ILUSTRATIVA</text>
        <text x="70" y="136" font-family="Arial, sans-serif" font-size="22" fill="#8DE8FF">PROCEDIMIENTO · DEMO</text>
        <rect x="70" y="184" width="660" height="676" rx="30" fill="#F4F7FB"/>
        <path d="M350 250 C320 335 320 440 340 535 C352 594 330 690 312 790 L488 790 C470 690 448 594 460 535 C480 440 480 335 450 250 Z" fill="#D5E6F7" stroke="#82ACD7" stroke-width="5"/>
        <ellipse cx="448" cy="594" rx="104" ry="82" fill="url(#mark)"/>
        <circle cx="448" cy="594" r="28" fill="#00C7FF" stroke="#fff" stroke-width="9"/>
        <path d="M505 550 L628 445" fill="none" stroke="#1E40AF" stroke-width="6"/>
        <rect x="505" y="376" width="176" height="76" rx="16" fill="#fff" stroke="#1E40AF" stroke-width="3"/>
        <text x="593" y="407" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0B1026">ZONA ILUSTRADA</text>
        <text x="593" y="433" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#1E40AF">NO ES FOTOGRAFÍA</text>
        <rect x="70" y="900" width="660" height="124" rx="24" fill="#00C7FF" opacity="0.16"/>
        <text x="400" y="958" text-anchor="middle" font-family="Arial, sans-serif" font-size="29" font-weight="700" fill="#fff">DATOS SINTÉTICOS / DEMO</text>
        <text x="400" y="994" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#BDEFFF">Sin paciente real · Imagen generada localmente</text>
      </svg>`,
  },
];

interface PreparedImage extends DemoImageDefinition {
  buffer: Buffer;
  storagePath: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  previousBuffer: Buffer | null;
  fileChanged: boolean;
}

function assertDemoExecutionAllowed(validateOnly: boolean): string {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Seed demo bloqueado: NODE_ENV debe ser exactamente "development".');
  }
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Seed demo bloqueado: confirma explícitamente con ALLOW_DEMO_SEED=true.');
  }

  const password = process.env.DEMO_MEDICO_PASSWORD;
  if (!password || password.length < 8 || password.length > 100) {
    throw new Error('DEMO_MEDICO_PASSWORD es obligatorio y debe tener entre 8 y 100 caracteres.');
  }
  if (!validateOnly && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL es obligatorio para ejecutar el seed demo.');
  }
  return password;
}

function resolvePrivatePath(uploadRoot: string, storagePath: string): string {
  if (isAbsolute(storagePath)) {
    throw new Error(`Ruta demo absoluta rechazada: ${storagePath}`);
  }
  const absolutePath = resolve(uploadRoot, storagePath);
  const fromRoot = relative(uploadRoot, absolutePath);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Ruta demo fuera de UPLOAD_DIR rechazada: ${storagePath}`);
  }
  return absolutePath;
}

function validateRecordFixtures(): Map<string, Prisma.InputJsonObject> {
  const expectedTypes = new Set(Object.values(RecordType));
  const actualTypes = new Set(DEMO_RECORDS.map((record) => record.recordType));
  if (
    DEMO_RECORDS.length !== expectedTypes.size ||
    [...expectedTypes].some((type) => !actualTypes.has(type))
  ) {
    throw new Error('El seed demo debe contener exactamente un registro de cada RecordType.');
  }

  const normalized = new Map<string, Prisma.InputJsonObject>();
  for (const record of DEMO_RECORDS) {
    const attendedAt = new Date(record.attendedAt);
    if (Number.isNaN(attendedAt.getTime())) {
      throw new Error(`Fecha attendedAt inválida para ${record.recordType}.`);
    }
    const validation = validateClinicalRecordDetails(record.recordType, record.details);
    if (!validation.value || validation.errors.length > 0) {
      throw new Error(
        `Details demo inválidos para ${record.recordType}: ${validation.errors.join(' ')}`,
      );
    }
    normalized.set(record.id, validation.value);
  }
  return normalized;
}

async function prepareImages(uploadRoot: string): Promise<PreparedImage[]> {
  return Promise.all(
    DEMO_IMAGES.map(async (definition) => {
      const buffer = await sharp(Buffer.from(definition.svg))
        .rotate()
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
      const metadata = await sharp(buffer).metadata();
      if (
        metadata.format !== 'png' ||
        metadata.width !== definition.width ||
        metadata.height !== definition.height ||
        buffer.byteLength < 1 ||
        buffer.byteLength > MAX_IMAGE_BYTES ||
        definition.width * definition.height > MAX_IMAGE_PIXELS
      ) {
        throw new Error(`Imagen demo inválida: ${definition.originalName}.`);
      }

      const filename = `${createHash('sha256')
        .update(definition.storageSeed)
        .digest('hex')
        .slice(0, 48)}.png`;
      const storagePath = `record-media/${DEMO_PATIENT_ID}/${filename}`;
      return {
        ...definition,
        buffer,
        storagePath,
        absolutePath: resolvePrivatePath(uploadRoot, storagePath),
        sizeBytes: buffer.byteLength,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        previousBuffer: null,
        fileChanged: false,
      };
    }),
  );
}

function assertSameOwner(existing: { id: string } | null, expectedId: string, label: string): void {
  if (existing && existing.id !== expectedId) {
    throw new Error(`Colisión con datos no demo en ${label}; no se realizó ningún cambio.`);
  }
}

async function preflightDatabase(
  prisma: PrismaClient,
  images: PreparedImage[],
): Promise<Set<string>> {
  const medicoRole = await prisma.role.findUnique({ where: { key: 'MEDICO' } });
  if (!medicoRole) {
    throw new Error('Falta el rol MEDICO. Ejecuta primero el seed base (npm run db:seed).');
  }

  const [userById, userByEmail, userByUsername, userByDocument] = await Promise.all([
    prisma.user.findUnique({ where: { id: DEMO_USER_ID } }),
    prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } }),
    prisma.user.findUnique({ where: { username: DEMO_USER_USERNAME } }),
    prisma.user.findUnique({ where: { documentNumber: DEMO_USER_DOCUMENT } }),
  ]);
  assertSameOwner(userByEmail, DEMO_USER_ID, 'email del profesional');
  assertSameOwner(userByUsername, DEMO_USER_ID, 'username del profesional');
  assertSameOwner(userByDocument, DEMO_USER_ID, 'documento del profesional');
  if (
    userById &&
    (userById.email !== DEMO_USER_EMAIL ||
      userById.username !== DEMO_USER_USERNAME ||
      userById.documentNumber !== DEMO_USER_DOCUMENT)
  ) {
    throw new Error('El UUID reservado del profesional pertenece a otro dato; seed abortado.');
  }

  const [patientById, patientByDocument] = await Promise.all([
    prisma.patient.findUnique({ where: { id: DEMO_PATIENT_ID } }),
    prisma.patient.findUnique({
      where: {
        documentType_documentNumber: {
          documentType: DocumentType.OTHER,
          documentNumber: DEMO_PATIENT_DOCUMENT,
        },
      },
    }),
  ]);
  assertSameOwner(patientByDocument, DEMO_PATIENT_ID, 'documento del paciente');
  if (
    patientById &&
    (patientById.documentType !== DocumentType.OTHER ||
      patientById.documentNumber !== DEMO_PATIENT_DOCUMENT)
  ) {
    throw new Error('El UUID reservado del paciente pertenece a otro dato; seed abortado.');
  }

  const recordIds = DEMO_RECORDS.map((record) => record.id);
  const existingRecords = await prisma.clinicalRecord.findMany({
    where: { id: { in: recordIds } },
  });
  const fixtureByRecordId = new Map(DEMO_RECORDS.map((record) => [record.id, record]));
  for (const existing of existingRecords) {
    const fixture = fixtureByRecordId.get(existing.id);
    if (
      !fixture ||
      existing.patientId !== DEMO_PATIENT_ID ||
      existing.recordType !== fixture.recordType ||
      existing.createdBy !== DEMO_USER_ID
    ) {
      throw new Error(`Colisión con el UUID reservado del registro ${existing.id}; seed abortado.`);
    }
  }

  const imageIds = images.map((image) => image.id);
  const storagePaths = images.map((image) => image.storagePath);
  const existingImages = await prisma.clinicalMediaAsset.findMany({
    where: { OR: [{ id: { in: imageIds } }, { storagePath: { in: storagePaths } }] },
    include: { attachments: true },
  });
  const imageById = new Map(images.map((image) => [image.id, image]));
  const imageByPath = new Map(images.map((image) => [image.storagePath, image]));
  const ownedStoragePaths = new Set<string>();
  for (const existing of existingImages) {
    const byId = imageById.get(existing.id);
    const byPath = imageByPath.get(existing.storagePath);
    if (
      !byId ||
      !byPath ||
      byId.id !== byPath.id ||
      existing.patientId !== DEMO_PATIENT_ID ||
      existing.uploadedBy !== DEMO_USER_ID
    ) {
      throw new Error('Colisión con un asset o storagePath no demo; seed abortado.');
    }
    if (
      existing.attachments.some(
        (attachment) =>
          attachment.id !== byId.attachmentId || attachment.clinicalRecordId !== byId.recordId,
      )
    ) {
      throw new Error(
        `El asset demo ${existing.id} tiene asociaciones no esperadas; seed abortado.`,
      );
    }
    ownedStoragePaths.add(existing.storagePath);
  }

  const attachmentIds = images.map((image) => image.attachmentId);
  const existingAttachments = await prisma.clinicalRecordAttachment.findMany({
    where: {
      OR: [
        { id: { in: attachmentIds } },
        ...images.map((image) => ({ clinicalRecordId: image.recordId, assetId: image.id })),
      ],
    },
  });
  const imageByAttachmentId = new Map(images.map((image) => [image.attachmentId, image]));
  for (const existing of existingAttachments) {
    const fixture = imageByAttachmentId.get(existing.id);
    if (
      !fixture ||
      existing.clinicalRecordId !== fixture.recordId ||
      existing.assetId !== fixture.id ||
      existing.createdBy !== DEMO_USER_ID
    ) {
      throw new Error('Colisión con una asociación de imagen no demo; seed abortado.');
    }
  }

  return ownedStoragePaths;
}

async function writeDemoImages(
  images: PreparedImage[],
  ownedStoragePaths: ReadonlySet<string>,
): Promise<void> {
  for (const image of images) {
    let previousBuffer: Buffer | null = null;
    try {
      previousBuffer = await readFile(image.absolutePath);
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    if (previousBuffer && !ownedStoragePaths.has(image.storagePath)) {
      throw new Error(
        `Existe un archivo no registrado en la ruta reservada ${image.storagePath}; seed abortado.`,
      );
    }

    image.previousBuffer = previousBuffer;
    if (previousBuffer?.equals(image.buffer)) continue;

    await mkdir(dirname(image.absolutePath), { recursive: true });
    await writeFile(image.absolutePath, image.buffer);
    image.fileChanged = true;
  }
}

async function restoreImagesAfterFailure(images: PreparedImage[]): Promise<void> {
  for (const image of images.filter((candidate) => candidate.fileChanged)) {
    try {
      if (image.previousBuffer) {
        await writeFile(image.absolutePath, image.previousBuffer);
      } else {
        await unlink(image.absolutePath);
      }
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code !== 'ENOENT') {
        console.error(`No se pudo restaurar el archivo demo ${image.storagePath}.`);
      }
    }
  }
}

async function seedDatabase(
  prisma: PrismaClient,
  password: string,
  normalizedDetails: ReadonlyMap<string, Prisma.InputJsonObject>,
  images: PreparedImage[],
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(
    async (tx) => {
      const medicoRole = await tx.role.findUniqueOrThrow({ where: { key: 'MEDICO' } });

      await tx.user.upsert({
        where: { id: DEMO_USER_ID },
        update: {
          email: DEMO_USER_EMAIL,
          username: DEMO_USER_USERNAME,
          firstName: 'Valeria',
          lastName: 'Demo ClinicView',
          fullName: 'Dra. Valeria Demo ClinicView',
          documentType: DocumentType.OTHER,
          documentNumber: DEMO_USER_DOCUMENT,
          profession: 'Medicina general (usuario sintético)',
          passwordHash,
          isActive: true,
          updatedAt: DEMO_UPDATED_AT,
          updatedBy: DEMO_USER_ID,
          version: 0,
        },
        create: {
          id: DEMO_USER_ID,
          email: DEMO_USER_EMAIL,
          username: DEMO_USER_USERNAME,
          firstName: 'Valeria',
          lastName: 'Demo ClinicView',
          fullName: 'Dra. Valeria Demo ClinicView',
          documentType: DocumentType.OTHER,
          documentNumber: DEMO_USER_DOCUMENT,
          profession: 'Medicina general (usuario sintético)',
          passwordHash,
          isActive: true,
          createdAt: DEMO_CREATED_AT,
          updatedAt: DEMO_UPDATED_AT,
          createdBy: DEMO_USER_ID,
          updatedBy: DEMO_USER_ID,
          version: 0,
        },
      });

      await tx.userRole.upsert({
        where: { userId_roleId: { userId: DEMO_USER_ID, roleId: medicoRole.id } },
        update: {},
        create: { userId: DEMO_USER_ID, roleId: medicoRole.id },
      });

      await tx.patient.upsert({
        where: { id: DEMO_PATIENT_ID },
        update: {
          documentType: DocumentType.OTHER,
          documentNumber: DEMO_PATIENT_DOCUMENT,
          firstName: 'Paciente',
          lastName: 'Sintético ClinicView',
          dateOfBirth: new Date('1992-04-18T00:00:00.000Z'),
          sex: Sex.F,
          phone: '900000000',
          email: 'paciente.demo@example.invalid',
          address: 'Dirección ficticia 123 - DATOS DEMO',
          isActive: true,
          updatedAt: DEMO_UPDATED_AT,
          updatedBy: DEMO_USER_ID,
          version: 0,
        },
        create: {
          id: DEMO_PATIENT_ID,
          documentType: DocumentType.OTHER,
          documentNumber: DEMO_PATIENT_DOCUMENT,
          firstName: 'Paciente',
          lastName: 'Sintético ClinicView',
          dateOfBirth: new Date('1992-04-18T00:00:00.000Z'),
          sex: Sex.F,
          phone: '900000000',
          email: 'paciente.demo@example.invalid',
          address: 'Dirección ficticia 123 - DATOS DEMO',
          isActive: true,
          createdAt: DEMO_CREATED_AT,
          updatedAt: DEMO_UPDATED_AT,
          createdBy: DEMO_USER_ID,
          updatedBy: DEMO_USER_ID,
          version: 0,
        },
      });

      for (const record of DEMO_RECORDS) {
        const commonData = {
          patientId: DEMO_PATIENT_ID,
          recordType: record.recordType,
          origin: RecordOrigin.MANUAL,
          status: RecordStatus.ACTIVE,
          attendedAt: new Date(record.attendedAt),
          summary: record.summary,
          notes: record.notes,
          details: normalizedDetails.get(record.id)!,
          schemaVersion: CLINICAL_RECORD_SCHEMA_VERSION,
          doctorName: 'Dra. Valeria Demo ClinicView',
          professionalId: DEMO_USER_ID,
          professionalNameSnapshot: 'Dra. Valeria Demo ClinicView',
          professionalLicenseSnapshot: 'CMP DEMO-00000',
          service: record.service,
          preliminaryDiagnosis: record.preliminaryDiagnosis,
          plan: record.plan,
          priority: record.priority,
          parentRecordId: null,
          voidReason: null,
          updatedAt: DEMO_UPDATED_AT,
          updatedBy: DEMO_USER_ID,
          version: 0,
        } satisfies Prisma.ClinicalRecordUncheckedUpdateInput;

        await tx.clinicalRecord.upsert({
          where: { id: record.id },
          update: commonData,
          create: {
            id: record.id,
            ...commonData,
            createdAt: new Date(new Date(record.attendedAt).getTime() + 5 * 60 * 1000),
            createdBy: DEMO_USER_ID,
          },
        });
      }

      for (const image of images) {
        const mediaData = {
          patientId: DEMO_PATIENT_ID,
          uploadedBy: DEMO_USER_ID,
          originalName: image.originalName,
          storagePath: image.storagePath,
          mimeType: 'image/png',
          sizeBytes: image.sizeBytes,
          width: image.width,
          height: image.height,
          sha256: image.sha256,
          status: ClinicalMediaStatus.ATTACHED,
          expiresAt: null,
          version: 0,
          updatedAt: DEMO_UPDATED_AT,
        } satisfies Prisma.ClinicalMediaAssetUncheckedUpdateInput;

        await tx.clinicalMediaAsset.upsert({
          where: { id: image.id },
          update: mediaData,
          create: {
            id: image.id,
            ...mediaData,
            createdAt: DEMO_UPDATED_AT,
          },
        });

        await tx.clinicalRecordAttachment.upsert({
          where: { id: image.attachmentId },
          update: {
            clinicalRecordId: image.recordId,
            assetId: image.id,
            sectionKey: image.sectionKey,
            caption: image.caption,
            altText: image.altText,
            sortOrder: 0,
            createdBy: DEMO_USER_ID,
          },
          create: {
            id: image.attachmentId,
            clinicalRecordId: image.recordId,
            assetId: image.id,
            sectionKey: image.sectionKey,
            caption: image.caption,
            altText: image.altText,
            sortOrder: 0,
            createdBy: DEMO_USER_ID,
            createdAt: DEMO_UPDATED_AT,
          },
        });
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main(): Promise<void> {
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== '--validate-only');
  if (unknownArguments.length > 0) {
    throw new Error(`Argumentos no soportados: ${unknownArguments.join(', ')}`);
  }
  const validateOnly = process.argv.includes('--validate-only');
  const password = assertDemoExecutionAllowed(validateOnly);
  const normalizedDetails = validateRecordFixtures();
  const uploadRoot = resolve(process.env.UPLOAD_DIR ?? './uploads');
  const images = await prepareImages(uploadRoot);

  if (validateOnly) {
    console.log(
      `Validacion correcta: ${DEMO_RECORDS.length} tipos clinicos y ${images.length} PNG sinteticos.`,
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const ownedStoragePaths = await preflightDatabase(prisma, images);
    try {
      await writeDemoImages(images, ownedStoragePaths);
      await seedDatabase(prisma, password, normalizedDetails, images);
    } catch (error) {
      await restoreImagesAfterFailure(images);
      throw error;
    }

    console.log('Seed demo completado con datos exclusivamente sintéticos:');
    console.log(`  Paciente: ${DEMO_PATIENT_DOCUMENT} (${DEMO_PATIENT_ID})`);
    console.log(`  Profesional: ${DEMO_USER_EMAIL}, rol MEDICO`);
    console.log(`  Registros: ${DEMO_RECORDS.length} (uno por RecordType)`);
    console.log(`  Imágenes PNG privadas: ${images.length}`);
    console.log('  La contraseña se leyó del entorno y no se muestra.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`Seed demo fallido: ${message}`);
  process.exitCode = 1;
});

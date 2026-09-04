import * as bcrypt from 'bcrypt';
import { PrismaClient, RecordType } from '@prisma/client';

export const CLINICAL_E2E_PHI = {
  patientFirstName: 'E2ePhiLucia',
  patientLastName: 'E2ePhiSalazar',
  documentNumber: 'E2EPHI240901',
  email: 'e2e-phi-patient@clinicview.invalid',
  address: 'E2E PHI ADDRESS SENTINEL 7042',
  recordSummary: 'E2E PHI RECORD SUMMARY SENTINEL 7042',
  recordNotes: 'E2E PHI RECORD NOTES SENTINEL 7042',
  imageFilename: 'E2E-PHI-IMAGE-SENTINEL-7042.png',
  documentFilename: 'E2E-PHI-DOCUMENT-SENTINEL-7042.pdf',
  ocrText: 'E2E PHI OCR TEXT SENTINEL 7042',
} as const;

const CLINICAL_PERMISSIONS = [
  'patients.read',
  'patients.create',
  'records.read',
  'records.create',
  'records.correct',
  'records.void',
  'documents.read',
  'documents.upload',
  'documents.validate',
  'documents.reject',
  'review.read',
  'review.assign',
  'admin.audit.read',
] as const;

export interface ClinicalE2eIdentity {
  id: string;
  email: string;
  password: string;
  username: string;
}

export interface ClinicalFlowFixture {
  clinician: ClinicalE2eIdentity;
  peerClinician: ClinicalE2eIdentity;
  reader: ClinicalE2eIdentity;
  limited: ClinicalE2eIdentity;
}

export const VALID_RECORD_DETAILS: Record<RecordType, Record<string, unknown>> = {
  [RecordType.CONSULTATION]: {
    chiefComplaint: 'Dolor abdominal de dos días de evolución.',
    vitalSigns: { temperatureCelsius: 37.2, oxygenSaturation: 98 },
    diagnoses: [{ description: 'Dolor abdominal en estudio', code: 'R10.9' }],
  },
  [RecordType.EVOLUTION]: {
    evolution: 'Paciente estable y tolera la vía oral.',
    treatmentResponse: 'Respuesta favorable al manejo indicado.',
  },
  [RecordType.LAB_RESULT]: {
    studyName: 'Hemograma completo',
    collectedAt: '2026-08-31T08:30:00-05:00',
    issuedAt: '2026-08-31T10:30:00-05:00',
    results: [
      {
        analyte: 'Hemoglobina',
        value: '13.8',
        unit: 'g/dL',
        referenceRange: '12.0-16.0',
        flag: 'NORMAL',
      },
    ],
  },
  [RecordType.PRESCRIPTION]: {
    indication: 'Infección bacteriana documentada.',
    medications: [
      {
        name: 'Amoxicilina',
        concentration: '500 mg',
        dose: '500 mg',
        route: 'Oral',
        frequency: 'Cada 8 horas',
        duration: '7 días',
      },
    ],
    validFrom: '2026-08-31',
    validUntil: '2026-09-07',
  },
  [RecordType.PROCEDURE]: {
    procedureName: 'Curación de herida',
    technique: 'Lavado con solución salina y cobertura estéril.',
    complications: 'Sin complicaciones.',
    laterality: 'LEFT',
  },
  [RecordType.THERAPY_NOTE]: {
    discipline: 'Terapia física',
    sessionNumber: 4,
    interventions: 'Ejercicios activos asistidos.',
    response: 'Tolera la sesión sin dolor adicional.',
    measurements: [{ name: 'Flexión de rodilla', value: '105', unit: 'grados' }],
  },
  [RecordType.OTHER]: {
    title: 'Junta médica',
    category: 'Nota interdisciplinaria',
    content: 'Se revisó el plan terapéutico con el equipo tratante.',
  },
};

export async function createClinicalFlowFixture(
  prisma: PrismaClient,
): Promise<ClinicalFlowFixture> {
  const permissions = await Promise.all(
    CLINICAL_PERMISSIONS.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Permiso sintético E2E: ${key}` },
      }),
    ),
  );
  const permissionId = new Map(permissions.map((permission) => [permission.key, permission.id]));

  async function createRole(key: string, keys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key, name: `Rol sintético ${key}`, description: 'Uso exclusivo de E2E clínico.' },
    });
    await prisma.rolePermission.createMany({
      data: keys.map((permissionKey) => ({
        roleId: role.id,
        permissionId: permissionId.get(permissionKey) as string,
      })),
    });
    return role.id;
  }

  const clinicianRoleId = await createRole('E2E_CLINICIAN', CLINICAL_PERMISSIONS);
  const readerRoleId = await createRole('E2E_CLINICAL_READER', [
    'patients.read',
    'records.read',
    'documents.read',
  ]);
  const limitedRoleId = await createRole('E2E_PATIENTS_ONLY', ['patients.read']);

  async function createUser(
    roleId: string,
    suffix: string,
    password: string,
  ): Promise<ClinicalE2eIdentity> {
    const email = `${suffix}@clinicview.invalid`;
    const user = await prisma.user.create({
      data: {
        email,
        username: `e2e_${suffix}`,
        firstName: 'Profesional',
        lastName: `Sintético ${suffix}`,
        fullName: `Profesional Sintético ${suffix}`,
        profession: 'Profesional E2E',
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId } },
      },
    });
    return { id: user.id, email, username: user.username, password };
  }

  return {
    clinician: await createUser(
      clinicianRoleId,
      'clinical_owner',
      'E2E-Clinical-Owner-7042!',
    ),
    peerClinician: await createUser(
      clinicianRoleId,
      'clinical_peer',
      'E2E-Clinical-Peer-7042!',
    ),
    reader: await createUser(readerRoleId, 'clinical_reader', 'E2E-Clinical-Reader-7042!'),
    limited: await createUser(limitedRoleId, 'clinical_limited', 'E2E-Clinical-Limited-7042!'),
  };
}

import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditOutcome,
  DocumentStatus,
  Prisma,
  PrismaClient,
  RecordStatus,
  RecordType,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { IaClientService } from '../src/core/ia/ia-client.service';
import {
  CLINICAL_E2E_PHI,
  ClinicalE2eIdentity,
  ClinicalFlowFixture,
  createClinicalFlowFixture,
  VALID_RECORD_DETAILS,
} from './fixtures/clinical-flow.fixture';
import { jsonHeaders, jsonRequest } from './support/http-client';

interface TokenResponse {
  access_token: string;
}

interface PatientDraftResponse {
  id: string;
  payload: Record<string, unknown>;
  version: number;
  expiresAt: string;
  actorId?: string;
}

interface PatientResponse {
  id: string;
  documentNumber: string;
  firstName: string;
  dateOfBirth: string;
}

interface RecordDraftResponse {
  id: string;
  patientId: string;
  payload: Record<string, unknown>;
  version: number;
  expiresAt: string;
  actorId?: string;
}

interface MediaAssetResponse {
  id: string;
  patientId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  status: 'TEMPORARY' | 'ATTACHED';
  expiresAt: string | null;
  version: number;
  contentUrl: string;
  storagePath?: string;
}

interface RecordAttachmentResponse {
  assetId: string;
  sectionKey: string | null;
  caption: string | null;
  altText: string | null;
  sortOrder: number;
  asset: MediaAssetResponse;
}

interface RecordResponse {
  id: string;
  patientId: string;
  recordType: RecordType;
  status: RecordStatus;
  origin: 'MANUAL' | 'DIGITIZED';
  summary: string;
  details: Record<string, unknown>;
  schemaVersion: number;
  parentRecordId: string | null;
  voidReason: string | null;
  version: number;
  attachments: RecordAttachmentResponse[];
}

interface DocumentResponse {
  id: string;
  patientId: string;
  originalName: string;
  mimeType: string;
  status: DocumentStatus;
  ocrText: string | null;
  correctedText: string | null;
  validationAttested: boolean;
  validationChecklist: { schemaVersion: number; items: Array<{ id: string }> } | null;
  reviewPriority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  assignedReviewerId: string | null;
  version: number;
  storagePath?: string;
}

interface AssignmentResponse {
  documentId: string;
  version: number;
  assignee: { id: string; username: string } | null;
}

interface ClinicalHistoryExport {
  patient: PatientResponse;
  records: Array<RecordResponse & { createdBy: string | null }>;
  documents: Array<{
    id: string;
    status: DocumentStatus;
    clinicalText: string | null;
    textSource: 'CORRECTED' | 'OCR' | 'NONE';
  }>;
  generatedAt: string;
}

const PNG_2X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWNgOP7/PxjDGABdXAsVTWN7aAAAAABJRU5ErkJggg==',
  'base64',
);

const VALID_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'ascii',
);

const CHECKLIST_IDS = ['text', 'entities', 'sections', 'phi'] as const;

describe('Integridad clínica real y aislada (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let prisma: PrismaClient;
  let fixture: ClinicalFlowFixture;
  let baseUrl: string;
  let uploadDir: string;
  let previousUploadDir: string | undefined;
  let clinicianToken: string;
  let peerToken: string;
  let readerToken: string;
  let limitedToken: string;
  let patientId: string;
  let attachedAsset: MediaAssetResponse;
  let consultation: RecordResponse;
  const createdRecords = new Map<RecordType, RecordResponse>();

  const iaProcess = jest.fn(async () => ({
    ocrText: CLINICAL_E2E_PHI.ocrText,
    entities: [
      {
        type: 'DIAGNOSIS' as const,
        value: 'Cefalea tensional',
        normalizedValue: 'G44.2',
        confidence: 0.97,
      },
    ],
    metrics: {
      cer: 0.01,
      wer: 0.02,
      charAccuracy: 0.99,
      nerPrecision: 0.96,
      nerRecall: 0.95,
      nerF1: 0.955,
      estimated: false,
    },
    ocrConfidence: 0.98,
    confidenceLevel: 'HIGH' as const,
  }));

  async function login(identity: ClinicalE2eIdentity): Promise<string> {
    const { response, body } = await jsonRequest<TokenResponse>(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: identity.email,
        password: identity.password,
        rememberMe: false,
      }),
    });
    expect(response.status).toBe(200);
    return body.access_token;
  }

  async function uploadMultipart<T>(
    path: string,
    accessToken: string,
    bytes: Buffer,
    filename: string,
    mimeType: string,
  ) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
    return jsonRequest<T>(baseUrl, path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: 'http://localhost:3000',
      },
      body: form,
    });
  }

  async function waitForDocumentStatus(
    documentId: string,
    expectedStatus: DocumentStatus,
  ): Promise<DocumentResponse> {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await jsonRequest<DocumentResponse>(
        baseUrl,
        `/api/patients/${patientId}/documents/${documentId}`,
        { headers: jsonHeaders(clinicianToken) },
      );
      expect(current.response.status).toBe(200);
      if (current.body.status === expectedStatus) return current.body;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    throw new Error(`El documento ${documentId} no alcanzó el estado ${expectedStatus}.`);
  }

  async function uploadAndProcessDocument(filename: string): Promise<DocumentResponse> {
    const uploaded = await uploadMultipart<DocumentResponse>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      filename,
      'application/pdf',
    );
    expect(uploaded.response.status).toBe(201);
    expect(uploaded.body.status).toBe(DocumentStatus.PENDING);

    const processing = await jsonRequest<DocumentResponse>(
      baseUrl,
      `/api/patients/${patientId}/documents/${uploaded.body.id}/process`,
      { method: 'POST', headers: jsonHeaders(clinicianToken) },
    );
    expect(processing.response.status).toBe(200);
    expect(processing.body.status).toBe(DocumentStatus.PROCESSING);
    return waitForDocumentStatus(uploaded.body.id, DocumentStatus.PROCESSED);
  }

  async function claimDocument(document: DocumentResponse): Promise<AssignmentResponse> {
    const claimed = await jsonRequest<AssignmentResponse>(
      baseUrl,
      `/api/review/documents/${document.id}/claim`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({ expectedVersion: document.version }),
      },
    );
    expect(claimed.response.status).toBe(200);
    expect(claimed.body.assignee).toEqual(
      expect.objectContaining({ id: fixture.clinician.id, username: fixture.clinician.username }),
    );
    return claimed.body;
  }

  beforeAll(async () => {
    previousUploadDir = process.env.UPLOAD_DIR;
    uploadDir = await mkdtemp(join(tmpdir(), 'clinicview-e2e-clinical-'));
    process.env.UPLOAD_DIR = uploadDir;

    prisma = new PrismaClient();
    await prisma.$connect();
    fixture = await createClinicalFlowFixture(prisma);

    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IaClientService)
      .useValue({ process: iaProcess })
      .compile();
    app = moduleFixture.createNestApplication({ logger: false });
    setupApp(app, { enableSwagger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    clinicianToken = await login(fixture.clinician);
    peerToken = await login(fixture.peerClinician);
    readerToken = await login(fixture.reader);
    limitedToken = await login(fixture.limited);
  });

  afterAll(async () => {
    await app?.close();
    if (patientId) {
      await prisma.clinicalRecordAttachment.deleteMany({
        where: { clinicalRecord: { patientId } },
      });
      await prisma.clinicalRecordDraft.deleteMany({ where: { patientId } });
      await prisma.clinicalRecord.deleteMany({
        where: { patientId, parentRecordId: { not: null } },
      });
      await prisma.clinicalRecord.deleteMany({ where: { patientId } });
      await prisma.clinicalMediaAsset.deleteMany({ where: { patientId } });
      await prisma.medicalDocument.deleteMany({ where: { patientId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
    }
    await prisma?.$disconnect();
    const safeTempRoot = `${resolve(tmpdir())}${sep}`.toLowerCase();
    const resolvedUploadDir = resolve(uploadDir ?? '');
    if (resolvedUploadDir.toLowerCase().startsWith(safeTempRoot)) {
      await rm(resolvedUploadDir, { recursive: true, force: true });
    }
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
  });

  it('protege el alta y consume un borrador de paciente con CAS y TTL', async () => {
    const patientPayload = {
      documentType: 'DNI',
      documentNumber: CLINICAL_E2E_PHI.documentNumber,
      firstName: CLINICAL_E2E_PHI.patientFirstName,
      lastName: CLINICAL_E2E_PHI.patientLastName,
      dateOfBirth: '1990-05-20',
      sex: 'F',
      email: CLINICAL_E2E_PHI.email,
      address: CLINICAL_E2E_PHI.address,
    };

    const beforeDenied = await prisma.patient.count();
    const anonymous = await jsonRequest<unknown>(baseUrl, '/api/patients', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(patientPayload),
    });
    expect(anonymous.response.status).toBe(401);

    const forbidden = await jsonRequest<unknown>(baseUrl, '/api/patients', {
      method: 'POST',
      headers: jsonHeaders(limitedToken),
      body: JSON.stringify(patientPayload),
    });
    expect(forbidden.response.status).toBe(403);
    expect(await prisma.patient.count()).toBe(beforeDenied);

    const createdDraft = await jsonRequest<PatientDraftResponse>(
      baseUrl,
      '/api/patients/draft/current',
      {
        method: 'PUT',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          payload: {
            documentType: 'DNI',
            documentNumber: CLINICAL_E2E_PHI.documentNumber,
            firstName: CLINICAL_E2E_PHI.patientFirstName,
          },
        }),
      },
    );
    expect(createdDraft.response.status).toBe(200);
    expect(createdDraft.body.version).toBe(0);
    expect(createdDraft.body.actorId).toBeUndefined();

    const privateToPeer = await jsonRequest<unknown>(baseUrl, '/api/patients/draft/current', {
      headers: jsonHeaders(peerToken),
    });
    expect(privateToPeer.response.status).toBe(204);

    const updatedDraft = await jsonRequest<PatientDraftResponse>(
      baseUrl,
      '/api/patients/draft/current',
      {
        method: 'PUT',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedId: createdDraft.body.id,
          expectedVersion: createdDraft.body.version,
          payload: patientPayload,
        }),
      },
    );
    expect(updatedDraft.response.status).toBe(200);
    expect(updatedDraft.body.version).toBe(1);

    const staleDraft = await jsonRequest<unknown>(baseUrl, '/api/patients/draft/current', {
      method: 'PUT',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        expectedId: createdDraft.body.id,
        expectedVersion: 0,
        payload: { firstName: 'No debe sobrescribir' },
      }),
    });
    expect(staleDraft.response.status).toBe(409);

    const expiringPeerDraft = await jsonRequest<PatientDraftResponse>(
      baseUrl,
      '/api/patients/draft/current',
      {
        method: 'PUT',
        headers: jsonHeaders(peerToken),
        body: JSON.stringify({ payload: { firstName: 'Temporal' } }),
      },
    );
    expect(expiringPeerDraft.response.status).toBe(200);
    await prisma.patientRegistrationDraft.update({
      where: { id: expiringPeerDraft.body.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await jsonRequest<unknown>(baseUrl, '/api/patients/draft/current', {
      headers: jsonHeaders(peerToken),
    });
    expect(expired.response.status).toBe(204);
    expect(
      await prisma.patientRegistrationDraft.findUnique({
        where: { id: expiringPeerDraft.body.id },
      }),
    ).toBeNull();

    const created = await jsonRequest<PatientResponse>(baseUrl, '/api/patients', {
      method: 'POST',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        ...patientPayload,
        draftId: updatedDraft.body.id,
        expectedDraftVersion: updatedDraft.body.version,
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        documentNumber: CLINICAL_E2E_PHI.documentNumber,
        firstName: CLINICAL_E2E_PHI.patientFirstName,
        dateOfBirth: '1990-05-20',
      }),
    );
    patientId = created.body.id;

    const consumed = await jsonRequest<unknown>(baseUrl, '/api/patients/draft/current', {
      headers: jsonHeaders(clinicianToken),
    });
    expect(consumed.response.status).toBe(204);

    const replay = await jsonRequest<unknown>(baseUrl, '/api/patients', {
      method: 'POST',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        ...patientPayload,
        draftId: updatedDraft.body.id,
        expectedDraftVersion: updatedDraft.body.version,
      }),
    });
    expect(replay.response.status).toBe(409);
    expect(
      await prisma.patient.count({
        where: { documentNumber: CLINICAL_E2E_PHI.documentNumber },
      }),
    ).toBe(1);
  });

  it('normaliza media real, protege temporales y asocia una imagen al registro', async () => {
    const forbiddenBefore = await prisma.clinicalMediaAsset.count();
    const forbidden = await uploadMultipart<unknown>(
      `/api/patients/${patientId}/record-media`,
      limitedToken,
      PNG_2X2,
      'forbidden.png',
      'image/png',
    );
    expect(forbidden.response.status).toBe(403);
    expect(await prisma.clinicalMediaAsset.count()).toBe(forbiddenBefore);

    const uploaded = await uploadMultipart<MediaAssetResponse>(
      `/api/patients/${patientId}/record-media`,
      clinicianToken,
      PNG_2X2,
      CLINICAL_E2E_PHI.imageFilename,
      'image/png',
    );
    expect(uploaded.response.status).toBe(201);
    expect(uploaded.body).toEqual(
      expect.objectContaining({
        patientId,
        mimeType: 'image/png',
        width: 2,
        height: 2,
        status: 'TEMPORARY',
        version: 0,
      }),
    );
    expect(uploaded.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(uploaded.body.storagePath).toBeUndefined();
    attachedAsset = uploaded.body;

    const hiddenFromPeer = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/record-media/${attachedAsset.id}`,
      { headers: jsonHeaders(peerToken) },
    );
    expect(hiddenFromPeer.response.status).toBe(404);

    const metadata = await jsonRequest<MediaAssetResponse>(
      baseUrl,
      `/api/patients/${patientId}/record-media/${attachedAsset.id}`,
      { headers: jsonHeaders(clinicianToken) },
    );
    expect(metadata.response.status).toBe(200);
    expect(metadata.body.storagePath).toBeUndefined();

    const content = await fetch(
      `${baseUrl}/api/patients/${patientId}/record-media/${attachedAsset.id}/content`,
      { headers: { Authorization: `Bearer ${clinicianToken}` } },
    );
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toContain('image/png');
    expect(content.headers.get('cache-control')).toContain('no-store');
    expect(content.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await content.arrayBuffer()).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

    const disposable = await uploadMultipart<MediaAssetResponse>(
      `/api/patients/${patientId}/record-media`,
      clinicianToken,
      PNG_2X2,
      'temporal-para-eliminar.png',
      'image/png',
    );
    expect(disposable.response.status).toBe(201);
    const staleDelete = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/record-media/${disposable.body.id}?expectedVersion=1`,
      { method: 'DELETE', headers: jsonHeaders(clinicianToken) },
    );
    expect(staleDelete.response.status).toBe(409);
    const deleted = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/record-media/${disposable.body.id}?expectedVersion=0`,
      { method: 'DELETE', headers: jsonHeaders(clinicianToken) },
    );
    expect(deleted.response.status).toBe(204);
    expect(await prisma.clinicalMediaAsset.findUnique({ where: { id: disposable.body.id } })).toBeNull();

    const recordDraft = await jsonRequest<RecordDraftResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/draft/current`,
      {
        method: 'PUT',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          payload: {
            recordType: RecordType.CONSULTATION,
            attendedAt: '2026-08-31T09:30:00-05:00',
            summary: CLINICAL_E2E_PHI.recordSummary,
            notes: CLINICAL_E2E_PHI.recordNotes,
            details: { chiefComplaint: 'Dolor abdominal.' },
            attachments: [
              {
                assetId: attachedAsset.id,
                sectionKey: 'physicalExam',
                caption: 'Vista clínica frontal',
                altText: 'Zona examinada sin identificadores visibles',
                sortOrder: 0,
              },
            ],
          },
        }),
      },
    );
    expect(recordDraft.response.status).toBe(200);
    expect(recordDraft.body.version).toBe(0);
    expect(recordDraft.body.actorId).toBeUndefined();

    const peerCannotSeeDraft = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records/draft/current`,
      { headers: jsonHeaders(peerToken) },
    );
    expect(peerCannotSeeDraft.response.status).toBe(204);

    const updatedDraft = await jsonRequest<RecordDraftResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/draft/current`,
      {
        method: 'PUT',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: recordDraft.body.version,
          payload: recordDraft.body.payload,
        }),
      },
    );
    expect(updatedDraft.response.status).toBe(200);
    expect(updatedDraft.body.version).toBe(1);

    const staleUpdate = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records/draft/current`,
      {
        method: 'PUT',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: 0,
          payload: { ...recordDraft.body.payload, summary: 'No debe ganar' },
        }),
      },
    );
    expect(staleUpdate.response.status).toBe(409);

    const countBeforeStaleConsumption = await prisma.clinicalRecord.count({ where: { patientId } });
    const incompleteDraftIdentity = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-08-31T09:30:00-05:00',
          summary: CLINICAL_E2E_PHI.recordSummary,
          details: VALID_RECORD_DETAILS[RecordType.CONSULTATION],
          schemaVersion: 1,
          draftId: updatedDraft.body.id,
        }),
      },
    );
    expect(incompleteDraftIdentity.response.status).toBe(400);
    expect(await prisma.clinicalRecord.count({ where: { patientId } })).toBe(
      countBeforeStaleConsumption,
    );

    const staleConsumption = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-08-31T09:30:00-05:00',
          summary: CLINICAL_E2E_PHI.recordSummary,
          notes: CLINICAL_E2E_PHI.recordNotes,
          details: VALID_RECORD_DETAILS[RecordType.CONSULTATION],
          schemaVersion: 1,
          attachments: recordDraft.body.payload.attachments,
          draftId: updatedDraft.body.id,
          expectedDraftVersion: 0,
        }),
      },
    );
    expect(staleConsumption.response.status).toBe(409);
    expect(await prisma.clinicalRecord.count({ where: { patientId } })).toBe(
      countBeforeStaleConsumption,
    );
    expect(
      await prisma.clinicalRecordDraft.findUnique({ where: { id: updatedDraft.body.id } }),
    ).toEqual(expect.objectContaining({ version: 1 }));

    const created = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-08-31T09:30:00-05:00',
          summary: CLINICAL_E2E_PHI.recordSummary,
          notes: CLINICAL_E2E_PHI.recordNotes,
          details: VALID_RECORD_DETAILS[RecordType.CONSULTATION],
          schemaVersion: 1,
          attachments: recordDraft.body.payload.attachments,
          draftId: updatedDraft.body.id,
          expectedDraftVersion: updatedDraft.body.version,
        }),
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body.origin).toBe('MANUAL');
    expect(created.body.attachments).toHaveLength(1);
    expect(created.body.attachments[0]).toEqual(
      expect.objectContaining({
        assetId: attachedAsset.id,
        sectionKey: 'physicalExam',
        sortOrder: 0,
      }),
    );
    expect(created.body.attachments[0]?.asset.status).toBe('ATTACHED');
    expect(created.body.attachments[0]?.asset.storagePath).toBeUndefined();
    consultation = created.body;
    createdRecords.set(RecordType.CONSULTATION, created.body);

    expect(
      await prisma.clinicalRecordDraft.findUnique({ where: { id: updatedDraft.body.id } }),
    ).toBeNull();
    const cannotDeleteAttached = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/record-media/${attachedAsset.id}?expectedVersion=1`,
      { method: 'DELETE', headers: jsonHeaders(clinicianToken) },
    );
    expect(cannotDeleteAttached.response.status).toBe(409);
  });

  it('crea los siete tipos con details discriminados y rechaza payloads cruzados', async () => {
    const countBeforeInvalid = await prisma.clinicalRecord.count({ where: { patientId } });
    const forbidden = await jsonRequest<unknown>(baseUrl, `/api/patients/${patientId}/records`, {
      method: 'POST',
      headers: jsonHeaders(limitedToken),
      body: JSON.stringify({
        recordType: RecordType.OTHER,
        attendedAt: '2026-08-31T11:00:00-05:00',
        summary: 'No debe persistir sin permiso.',
        details: VALID_RECORD_DETAILS[RecordType.OTHER],
        schemaVersion: 1,
      }),
    });
    expect(forbidden.response.status).toBe(403);
    expect(await prisma.clinicalRecord.count({ where: { patientId } })).toBe(countBeforeInvalid);

    const invalid = await jsonRequest<unknown>(baseUrl, `/api/patients/${patientId}/records`, {
      method: 'POST',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        recordType: RecordType.PRESCRIPTION,
        attendedAt: '2026-08-31T11:00:00-05:00',
        summary: 'Payload cruzado que debe ser rechazado.',
        details: VALID_RECORD_DETAILS[RecordType.CONSULTATION],
        schemaVersion: 1,
      }),
    });
    expect(invalid.response.status).toBe(400);
    expect(await prisma.clinicalRecord.count({ where: { patientId } })).toBe(countBeforeInvalid);

    for (const recordType of Object.values(RecordType)) {
      if (recordType === RecordType.CONSULTATION) continue;
      const result = await jsonRequest<RecordResponse>(
        baseUrl,
        `/api/patients/${patientId}/records`,
        {
          method: 'POST',
          headers: jsonHeaders(clinicianToken),
          body: JSON.stringify({
            recordType,
            attendedAt: '2026-08-31T11:00:00-05:00',
            summary: `Registro sintético E2E ${recordType}.`,
            doctorName: 'Dra. Elena Rivera',
            service: 'Medicina General',
            details: VALID_RECORD_DETAILS[recordType],
            schemaVersion: 1,
          }),
        },
      );
      expect(result.response.status).toBe(201);
      expect(result.body.recordType).toBe(recordType);
      expect(result.body.schemaVersion).toBe(1);
      expect(result.body.details).toEqual(VALID_RECORD_DETAILS[recordType]);
      createdRecords.set(recordType, result.body);
    }
    expect(createdRecords.size).toBe(Object.values(RecordType).length);

    const expiringDraft = await jsonRequest<RecordDraftResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/draft/current`,
      {
        method: 'PUT',
        headers: jsonHeaders(peerToken),
        body: JSON.stringify({ payload: { summary: 'Borrador clínico temporal.' } }),
      },
    );
    expect(expiringDraft.response.status).toBe(200);
    await prisma.clinicalRecordDraft.update({
      where: { id: expiringDraft.body.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records/draft/current`,
      { headers: jsonHeaders(peerToken) },
    );
    expect(expired.response.status).toBe(204);
    expect(
      await prisma.clinicalRecordDraft.findUnique({ where: { id: expiringDraft.body.id } }),
    ).toBeNull();
  });

  it('corrige y anula de forma atómica con expectedVersion', async () => {
    const corrected = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/${consultation.id}/correct`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: consultation.version,
          summary: 'Resumen clínico corregido E2E.',
        }),
      },
    );
    expect(corrected.response.status).toBe(201);
    expect(corrected.body.parentRecordId).toBe(consultation.id);
    expect(corrected.body.status).toBe(RecordStatus.ACTIVE);
    expect(corrected.body.attachments).toHaveLength(1);

    const original = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/${consultation.id}`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(original.response.status).toBe(200);
    expect(original.body.status).toBe(RecordStatus.CORRECTED);
    expect(original.body.version).toBe(consultation.version + 1);

    const staleCorrection = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records/${consultation.id}/correct`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: consultation.version,
          summary: 'Esta corrección no debe persistir.',
        }),
      },
    );
    expect(staleCorrection.response.status).toBe(409);
    expect(
      await prisma.clinicalRecord.count({ where: { parentRecordId: consultation.id } }),
    ).toBe(1);

    const voided = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/${corrected.body.id}/void`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: corrected.body.version,
          reason: 'Duplicado clínico confirmado durante control E2E.',
        }),
      },
    );
    expect(voided.response.status).toBe(200);
    expect(voided.body.status).toBe(RecordStatus.VOIDED);
    expect(voided.body.version).toBe(corrected.body.version + 1);

    const staleVoid = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records/${corrected.body.id}/void`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: corrected.body.version,
          reason: 'Segundo intento obsoleto que debe fallar.',
        }),
      },
    );
    expect(staleVoid.response.status).toBe(409);
  });

  it('valida MIME real, procesa sin IA externa y resuelve carreras de revisión', async () => {
    const forbiddenBefore = await prisma.medicalDocument.count({ where: { patientId } });
    const forbidden = await uploadMultipart<unknown>(
      `/api/patients/${patientId}/documents`,
      limitedToken,
      VALID_PDF,
      'sin-permiso.pdf',
      'application/pdf',
    );
    expect(forbidden.response.status).toBe(403);
    expect(await prisma.medicalDocument.count({ where: { patientId } })).toBe(forbiddenBefore);

    const mismatchedExtension = await uploadMultipart<unknown>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'declarado-como-imagen.png',
      'application/pdf',
    );
    expect(mismatchedExtension.response.status).toBe(415);

    const disguisedPdf = await uploadMultipart<unknown>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      Buffer.from('contenido ejecutable disfrazado'),
      'archivo-disfrazado.pdf',
      'application/pdf',
    );
    expect(disguisedPdf.response.status).toBe(415);

    let processed = await uploadAndProcessDocument(CLINICAL_E2E_PHI.documentFilename);
    expect(processed.ocrText).toBe(CLINICAL_E2E_PHI.ocrText);
    expect(iaProcess).toHaveBeenCalledWith(
      processed.id,
      expect.any(Buffer),
      'application/pdf',
    );

    const file = await fetch(
      `${baseUrl}/api/patients/${patientId}/documents/${processed.id}/file`,
      { headers: { Authorization: `Bearer ${readerToken}` } },
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('application/pdf');
    expect(file.headers.get('cache-control')).toContain('no-store');
    expect(file.headers.get('pragma')).toBe('no-cache');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(VALID_PDF);

    const claimed = await claimDocument(processed);
    processed = { ...processed, assignedReviewerId: fixture.clinician.id, version: claimed.version };

    const correction = await jsonRequest<DocumentResponse>(
      baseUrl,
      `/api/patients/${patientId}/documents/${processed.id}/correction`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: processed.version,
          correctedText: 'Texto clínico final corregido y verificado.',
          correctedEntities: [
            { type: 'DIAGNOSIS', value: 'Cefalea tensional', normalizedValue: 'G44.2' },
          ],
        }),
      },
    );
    expect(correction.response.status).toBe(200);
    expect(correction.body.version).toBe(processed.version + 1);

    const staleCorrection = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/documents/${processed.id}/correction`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: processed.version,
          correctedText: 'Texto obsoleto que no debe persistir.',
        }),
      },
    );
    expect(staleCorrection.response.status).toBe(409);

    const validated = await jsonRequest<DocumentResponse>(
      baseUrl,
      `/api/patients/${patientId}/documents/${processed.id}/validate`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: correction.body.version,
          correctedText: correction.body.correctedText,
          correctedEntities: [
            { type: 'DIAGNOSIS', value: 'Cefalea tensional', normalizedValue: 'G44.2' },
          ],
          checklistItems: CHECKLIST_IDS,
          attested: true,
        }),
      },
    );
    expect(validated.response.status).toBe(200);
    expect(validated.body.status).toBe(DocumentStatus.VALIDATED);
    expect(validated.body.validationAttested).toBe(true);
    expect(validated.body.validationChecklist?.items.map(({ id }) => id)).toEqual(
      CHECKLIST_IDS,
    );

    let racing = await uploadAndProcessDocument('carrera-validate-reject.pdf');
    const racingClaim = await claimDocument(racing);
    racing = { ...racing, assignedReviewerId: fixture.clinician.id, version: racingClaim.version };
    const [validateRace, rejectRace] = await Promise.all([
      jsonRequest<DocumentResponse>(
        baseUrl,
        `/api/patients/${patientId}/documents/${racing.id}/validate`,
        {
          method: 'PATCH',
          headers: jsonHeaders(clinicianToken),
          body: JSON.stringify({
            expectedVersion: racing.version,
            correctedText: 'Versión final del documento en carrera.',
            correctedEntities: [],
            checklistItems: CHECKLIST_IDS,
            attested: true,
          }),
        },
      ),
      jsonRequest<DocumentResponse>(
        baseUrl,
        `/api/patients/${patientId}/documents/${racing.id}/reject`,
        {
          method: 'PATCH',
          headers: jsonHeaders(clinicianToken),
          body: JSON.stringify({
            expectedVersion: racing.version,
            reason: 'Documento ilegible tras verificación clínica completa.',
          }),
        },
      ),
    ]);
    expect([validateRace.response.status, rejectRace.response.status].sort()).toEqual([200, 409]);
    const raceWinner = await jsonRequest<DocumentResponse>(
      baseUrl,
      `/api/patients/${patientId}/documents/${racing.id}`,
      { headers: jsonHeaders(clinicianToken) },
    );
    expect([DocumentStatus.VALIDATED, DocumentStatus.REJECTED]).toContain(raceWinner.body.status);

    const rejectedUpload = await uploadMultipart<DocumentResponse>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'rechazado-pendiente.pdf',
      'application/pdf',
    );
    expect(rejectedUpload.response.status).toBe(201);
    const rejected = await jsonRequest<DocumentResponse>(
      baseUrl,
      `/api/patients/${patientId}/documents/${rejectedUpload.body.id}/reject`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: rejectedUpload.body.version,
          reason: 'Documento duplicado detectado antes del procesamiento.',
        }),
      },
    );
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.status).toBe(DocumentStatus.REJECTED);

    const pending = await uploadMultipart<DocumentResponse>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'pendiente-export.pdf',
      'application/pdf',
    );
    expect(pending.response.status).toBe(201);

    await prisma.medicalDocument.createMany({
      data: [DocumentStatus.PROCESSING, DocumentStatus.PROCESSED, DocumentStatus.FAILED].map(
        (status, index): Prisma.MedicalDocumentCreateManyInput => ({
          patientId,
          originalName: `estado-${status.toLowerCase()}.pdf`,
          storagePath: `e2e-direct/${patientId}/${status.toLowerCase()}-${index}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: VALID_PDF.length,
          status,
          ocrText: status === DocumentStatus.PROCESSED ? 'Texto OCR no validado.' : null,
          processedAt: status === DocumentStatus.PROCESSED ? new Date() : null,
          createdBy: fixture.clinician.id,
        }),
      ),
    });
  });

  it('exporta la historia completa sin paginar, con estados y adjuntos', async () => {
    const filler: Prisma.ClinicalRecordCreateManyInput[] = Array.from(
      { length: 50 },
      (_, index) => ({
        patientId,
        recordType: RecordType.OTHER,
        status: RecordStatus.ACTIVE,
        attendedAt: new Date(Date.UTC(2026, 7, 1, 12, index % 60)),
        summary: `Registro de continuidad asistencial E2E ${index + 1}.`,
        details: {
          title: `Seguimiento ${index + 1}`,
          category: 'Continuidad asistencial',
          content: `Contenido clínico sintético ${index + 1}.`,
        },
        schemaVersion: 1,
        createdBy: fixture.clinician.id,
      }),
    );
    await prisma.clinicalRecord.createMany({ data: filler });

    const forbidden = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/clinical-history/export`,
      { headers: jsonHeaders(limitedToken) },
    );
    expect(forbidden.response.status).toBe(403);

    const exported = await jsonRequest<ClinicalHistoryExport>(
      baseUrl,
      `/api/patients/${patientId}/clinical-history/export`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(exported.response.status).toBe(200);
    expect(exported.response.headers.get('cache-control')).toContain('no-store');
    expect(exported.body.patient.id).toBe(patientId);
    const storedRecordCount = await prisma.clinicalRecord.count({ where: { patientId } });
    expect(storedRecordCount).toBeGreaterThan(50);
    expect(exported.body.records).toHaveLength(storedRecordCount);
    expect(new Set(exported.body.records.map(({ status }) => status))).toEqual(
      new Set(Object.values(RecordStatus)),
    );
    expect(new Set(exported.body.records.map(({ recordType }) => recordType))).toEqual(
      new Set(Object.values(RecordType)),
    );

    const exportedWithAttachment = exported.body.records.find(
      ({ id }) => id === consultation.id,
    );
    expect(exportedWithAttachment?.attachments).toHaveLength(1);
    expect(exportedWithAttachment?.attachments[0]).toEqual(
      expect.objectContaining({
        assetId: attachedAsset.id,
        sectionKey: 'physicalExam',
        caption: 'Vista clínica frontal',
      }),
    );
    expect(exportedWithAttachment?.attachments[0]?.asset.storagePath).toBeUndefined();

    expect(new Set(exported.body.documents.map(({ status }) => status))).toEqual(
      new Set(Object.values(DocumentStatus)),
    );
    const validated = exported.body.documents.find(
      ({ status }) => status === DocumentStatus.VALIDATED,
    );
    expect(validated?.clinicalText).toBeTruthy();
    expect(validated?.textSource).toBe('CORRECTED');
    expect(
      exported.body.documents
        .filter(({ status }) => status !== DocumentStatus.VALIDATED)
        .every(({ clinicalText, textSource }) => clinicalText === null && textSource === 'NONE'),
    ).toBe(true);
    expect(Number.isNaN(Date.parse(exported.body.generatedAt))).toBe(false);
  });

  it('no persiste PHI de payloads clínicos en la bitácora', async () => {
    const events = await prisma.auditEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.some(
        ({ action, outcome }) =>
          action === 'PATIENT_CREATED' && outcome === AuditOutcome.SUCCESS,
      ),
    ).toBe(true);
    expect(
      events.some(
        ({ action, outcome }) =>
          action === 'CLINICAL_RECORD_CREATED' && outcome === AuditOutcome.DENIED,
      ),
    ).toBe(true);

    const serialized = JSON.stringify(events);
    for (const sentinel of Object.values(CLINICAL_E2E_PHI)) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});

import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
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
import { IaClientService, ProcessResult } from '../src/core/ia/ia-client.service';
import { normalizeOcrLayout } from '../src/core/ia/ocr-layout';
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

  const iaProcess = jest.fn<Promise<ProcessResult>, Parameters<IaClientService['process']>>(
    async () => ({
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
    }),
  );

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
    metadata: Record<string, string> = {},
  ) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
    for (const [key, value] of Object.entries(metadata)) form.append(key, value);
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
      .useValue({ process: iaProcess, getPageImage: jest.fn(async () => PNG_2X2) })
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
    // Historical revisions deliberately reject row deletion. globalTeardown
    // drops only the explicitly validated clinicview_e2e schema for both suites.
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
    expect(
      await prisma.clinicalMediaAsset.findUnique({ where: { id: disposable.body.id } }),
    ).toBeNull();

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
    expect(await prisma.clinicalRecord.count({ where: { parentRecordId: consultation.id } })).toBe(
      1,
    );

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

  it('pagina todos los estados sin ocultar correcciones ni anulaciones', async () => {
    type Page = { data: RecordResponse[]; total: number; page: number; limit: number };
    const all = await jsonRequest<Page>(
      baseUrl,
      `/api/patients/${patientId}/records?status=ALL&limit=50`,
      { headers: jsonHeaders(clinicianToken) },
    );
    expect(all.response.status).toBe(200);
    expect(all.body.total).toBe(await prisma.clinicalRecord.count({ where: { patientId } }));
    expect(all.body.data.some((record) => record.status === RecordStatus.CORRECTED)).toBe(true);
    expect(all.body.data.some((record) => record.status === RecordStatus.VOIDED)).toBe(true);
    const first = await jsonRequest<Page>(
      baseUrl,
      `/api/patients/${patientId}/records?status=ALL&limit=1&page=1`,
      { headers: jsonHeaders(clinicianToken) },
    );
    const second = await jsonRequest<Page>(
      baseUrl,
      `/api/patients/${patientId}/records?status=ALL&limit=1&page=2`,
      { headers: jsonHeaders(clinicianToken) },
    );
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(first.body.data[0].id).toBe(all.body.data[0].id);
    expect(second.body.data[0].id).toBe(all.body.data[1].id);
    expect(first.body.total).toBe(second.body.total);
    const active = await jsonRequest<Page>(baseUrl, `/api/patients/${patientId}/records?limit=50`, {
      headers: jsonHeaders(clinicianToken),
    });
    expect(active.response.status).toBe(200);
    expect(active.body.data.every((record) => record.status === RecordStatus.ACTIVE)).toBe(true);
    const invalid = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/${patientId}/records?status=INVALID`,
      { headers: jsonHeaders(clinicianToken) },
    );
    expect(invalid.response.status).toBe(400);
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
    expect(iaProcess).toHaveBeenCalledWith(processed.id, expect.any(Buffer), 'application/pdf');

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
    processed = {
      ...processed,
      assignedReviewerId: fixture.clinician.id,
      version: claimed.version,
    };

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
    expect(validated.body.validationChecklist?.items.map(({ id }) => id)).toEqual(CHECKLIST_IDS);

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

    const exportedWithAttachment = exported.body.records.find(({ id }) => id === consultation.id);
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

  it('versiona la información longitudinal con RBAC, CAS y exportación de todas las revisiones', async () => {
    const patient = await prisma.patient.create({
      data: {
        documentType: 'OTHER',
        documentNumber: 'LONGITUDINAL-E2E',
        firstName: 'Paciente',
        lastName: 'Longitudinal Demo',
        dateOfBirth: new Date('1990-01-01'),
        sex: 'OTHER',
      },
    });
    const path = `/api/patients/${patient.id}/clinical-summary`;
    const denied = await jsonRequest<unknown>(baseUrl, path, {
      headers: jsonHeaders(limitedToken),
    });
    expect(denied.response.status).toBe(403);
    const initial = await jsonRequest<{ version: number; payload: { allergyStatus: string } }>(
      baseUrl,
      path,
      { headers: jsonHeaders(readerToken) },
    );
    expect(initial.body).toMatchObject({ version: 0, payload: { allergyStatus: 'UNKNOWN' } });
    const payload = {
      expectedVersion: 0,
      reason: CLINICAL_E2E_PHI.recordNotes,
      allergyStatus: 'NONE_KNOWN',
      allergies: [],
      problemStatus: 'UNKNOWN',
      problems: [],
      medicationStatus: 'UNKNOWN',
      medications: [],
    };
    const readerWrite = await jsonRequest<unknown>(baseUrl, path, {
      method: 'PUT',
      headers: jsonHeaders(readerToken),
      body: JSON.stringify(payload),
    });
    expect(readerWrite.response.status).toBe(403);
    const race = await Promise.all(
      [clinicianToken, peerToken].map((token) =>
        jsonRequest<{ version: number }>(baseUrl, path, {
          method: 'PUT',
          headers: jsonHeaders(token),
          body: JSON.stringify(payload),
        }),
      ),
    );
    expect(race.map((r) => r.response.status).sort()).toEqual([200, 409]);
    const second = await jsonRequest<{ version: number; recordedByName: string }>(baseUrl, path, {
      method: 'PUT',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        ...payload,
        expectedVersion: 1,
        allergyStatus: 'RECORDED',
        allergies: [
          {
            id: 'd3e0e47b-e88c-4d94-9f70-d8dde534d5ac',
            name: 'Sustancia demo',
            reaction: 'Reacción demo',
            severity: 'MILD',
          },
        ],
      }),
    });
    expect(second.response.status).toBe(200);
    expect(second.body).toMatchObject({
      version: 2,
      recordedByName: 'Profesional Sintético clinical_owner',
    });
    const exported = await jsonRequest<{
      clinicalSummaryRevisions: Array<{ version: number; payload: { allergyStatus: string } }>;
    }>(baseUrl, `/api/patients/${patient.id}/clinical-history/export`, {
      headers: jsonHeaders(readerToken),
    });
    expect(exported.body.clinicalSummaryRevisions.map((r) => r.version)).toEqual([2, 1]);
    expect(exported.body.clinicalSummaryRevisions[1].payload.allergyStatus).toBe('NONE_KNOWN');
    const latestPatient = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    const editPath = `/api/patients/${patient.id}`;
    const edits = await Promise.all(
      [clinicianToken, peerToken].map((token) =>
        jsonRequest<{ version: number }>(baseUrl, editPath, {
          method: 'PATCH',
          headers: jsonHeaders(token),
          body: JSON.stringify({
            expectedVersion: latestPatient.version,
            medicalRecordNumber: 'HC-E2E-001',
            emergencyContactName: 'Contacto demo',
          }),
        }),
      ),
    );
    expect(edits.map((r) => r.response.status).sort()).toEqual([200, 409]);
    const deactivate = await jsonRequest<unknown>(baseUrl, `${editPath}/deactivate`, {
      method: 'PATCH',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({ expectedVersion: latestPatient.version + 1 }),
    });
    expect(deactivate.response.status).toBe(200);
    const inactiveWrite = await jsonRequest<unknown>(baseUrl, path, {
      method: 'PUT',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({ ...payload, expectedVersion: 2 }),
    });
    expect(inactiveWrite.response.status).toBe(400);
    expect(
      await prisma.patientClinicalSummaryRevision.count({ where: { patientId: patient.id } }),
    ).toBe(2);
  });

  it('conserva procedencia clínica, rechaza fechas inválidas y protege correcciones concurrentes', async () => {
    const invalid = await uploadMultipart<unknown>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'fecha-invalida.pdf',
      'application/pdf',
      { clinicalDate: '2023-02-30' },
    );
    expect(invalid.response.status).toBe(400);
    const created = await uploadMultipart<{
      id: string;
      version: number;
      clinicalMetadata: { clinicalDate: string; pageCount: number };
    }>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'procedencia-demo.pdf',
      'application/pdf',
      {
        clinicalDate: '2023-09-27',
        documentKind: 'CLINICAL_HISTORY',
        pageCount: '2',
        sourceInstitution: 'Institución sintética E2E',
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body.clinicalMetadata).toMatchObject({
      clinicalDate: '2023-09-27',
      pageCount: 2,
    });
    const path = `/api/patients/${patientId}/documents/${created.body.id}/metadata`;
    const payload = {
      expectedVersion: created.body.version,
      metadata: { clinicalDate: '2023-09-28', clinicalEndDate: '2023-10-04', pageCount: 2 },
      reason: CLINICAL_E2E_PHI.recordNotes,
    };
    const denied = await jsonRequest<unknown>(baseUrl, path, {
      method: 'PATCH',
      headers: jsonHeaders(readerToken),
      body: JSON.stringify(payload),
    });
    expect(denied.response.status).toBe(403);
    const race = await Promise.all(
      [clinicianToken, peerToken].map((token) =>
        jsonRequest<{ version: number }>(baseUrl, path, {
          method: 'PATCH',
          headers: jsonHeaders(token),
          body: JSON.stringify(payload),
        }),
      ),
    );
    expect(race.map((r) => r.response.status).sort()).toEqual([200, 409]);
    const history = await jsonRequest<{
      data: Array<{ version: number; metadata: { clinicalDate: string } }>;
      nextBeforeVersion: number | null;
    }>(baseUrl, `${path}/history`, { headers: jsonHeaders(readerToken) });
    expect(history.response.status).toBe(200);
    expect(history.body.data.map((r) => r.metadata.clinicalDate)).toEqual([
      '2023-09-28',
      '2023-09-27',
    ]);
    const wrongPatient = await jsonRequest<unknown>(
      baseUrl,
      `/api/patients/ba6d1c31-c7fc-4742-98ee-1a7b4d880385/documents/${created.body.id}/metadata/history`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(wrongPatient.response.status).toBe(404);
    const exported = await jsonRequest<{
      documents: Array<{
        id: string;
        clinicalMetadata: { clinicalDate: string };
        metadataRevisions: unknown[];
      }>;
    }>(baseUrl, `/api/patients/${patientId}/clinical-history/export`, {
      headers: jsonHeaders(readerToken),
    });
    const document = exported.body.documents.find((item) => item.id === created.body.id);
    expect(document?.clinicalMetadata.clinicalDate).toBe('2023-09-28');
    expect(document?.metadataRevisions).toHaveLength(2);
  });

  it('protege las revisiones clínicas frente a UPDATE y DELETE en la base de pruebas', async () => {
    const summary = await prisma.patientClinicalSummaryRevision.findFirstOrThrow();
    const metadata = await prisma.documentMetadataRevision.findFirstOrThrow();
    await expect(
      prisma.patientClinicalSummaryRevision.update({
        where: { id: summary.id },
        data: { reason: 'Intento de reemplazo indebido' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.documentMetadataRevision.delete({ where: { id: metadata.id } }),
    ).rejects.toThrow();
    expect(
      await prisma.patientClinicalSummaryRevision.findUnique({ where: { id: summary.id } }),
    ).toEqual(summary);
    expect(
      await prisma.documentMetadataRevision.findUnique({ where: { id: metadata.id } }),
    ).toEqual(metadata);
  });

  it('publica desde un original validado con cita inmutable, fecha civil y prevención de duplicados', async () => {
    const uploaded = await uploadMultipart<DocumentResponse>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'original-transcripcion-e2e.pdf',
      'application/pdf',
    );
    expect(uploaded.response.status).toBe(201);
    const original = await prisma.medicalDocument.update({
      where: { id: uploaded.body.id },
      data: {
        status: 'VALIDATED',
        correctedText: CLINICAL_E2E_PHI.ocrText,
        clinicalMetadata: { clinicalDate: '2023-09-27', pageCount: 2 },
      },
    });
    const body = {
      recordType: 'CONSULTATION',
      attendancePrecision: 'DAY',
      attendedAt: '2023-09-27',
      summary: CLINICAL_E2E_PHI.recordSummary,
      details: VALID_RECORD_DETAILS.CONSULTATION,
      doctorName: 'Profesional original sintético',
      sourceDocumentId: original.id,
      expectedDocumentVersion: original.version,
      pageFrom: 1,
      pageTo: 2,
      sourceNote: CLINICAL_E2E_PHI.recordNotes,
      sourceVerified: true,
      publicationKey: randomUUID(),
    };
    type Published = RecordResponse & {
      attendedAt: string;
      attendancePrecision: string;
      createdByNameSnapshot: string;
      source: {
        documentId: string;
        documentVersion: number;
        pageFrom: number;
        publishedByName: string;
        publicationKey?: string;
      };
    };
    const publish = (payload: object, token = clinicianToken) =>
      jsonRequest<Published>(baseUrl, `/api/patients/${patientId}/records/from-document`, {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify(payload),
      });
    expect((await publish(body, readerToken)).response.status).toBe(403);
    expect((await publish({ ...body, sourceVerified: false })).response.status).toBe(400);
    expect((await publish({ ...body, pageTo: 3 })).response.status).toBe(400);
    expect((await publish({ ...body, attendedAt: '2023-02-30' })).response.status).toBe(400);
    expect((await publish({ ...body, sourceDocumentId: randomUUID() })).response.status).toBe(404);
    const race = await Promise.all([publish(body), publish(body)]);
    expect(race.map((result) => result.response.status).sort()).toEqual([201, 409]);
    const created = race.find((result) => result.response.status === 201)!.body;
    expect(created.origin).toBe('DIGITIZED');
    expect(created.attendancePrecision).toBe('DAY');
    expect(created.attendedAt).toBe('2023-09-27T05:00:00.000Z');
    expect(created.createdByNameSnapshot).toBeTruthy();
    expect(created.source).toMatchObject({
      documentId: original.id,
      documentVersion: original.version,
      pageFrom: 1,
    });
    expect(created.source.publicationKey).toBeUndefined();
    const duplicate = await publish({ ...body, expectedDocumentVersion: original.version + 1 });
    expect(duplicate.response.status).toBe(409);
    expect(await prisma.clinicalRecordSource.count({ where: { documentId: original.id } })).toBe(1);
    const corrected = await jsonRequest<Published>(
      baseUrl,
      `/api/patients/${patientId}/records/${created.id}/correct`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: created.version,
          summary: 'Corrección sintética conservando procedencia',
        }),
      },
    );
    expect(corrected.response.status).toBe(201);
    expect(corrected.body.source).toEqual(created.source);
    expect(corrected.body.attendancePrecision).toBe('DAY');
    const linked = await jsonRequest<{ data: Published[]; total: number }>(
      baseUrl,
      `/api/patients/${patientId}/records?status=ALL&sourceDocumentId=${original.id}`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(linked.response.status).toBe(200);
    expect(linked.body.total).toBe(2);
    const citation = await prisma.clinicalRecordSource.findUniqueOrThrow({
      where: { recordId: created.id },
    });
    await expect(
      prisma.clinicalRecordSource.update({ where: { id: citation.id }, data: { pageFrom: 2 } }),
    ).rejects.toThrow();
    const exported = await jsonRequest<{ records: Published[] }>(
      baseUrl,
      `/api/patients/${patientId}/clinical-history/export`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(exported.response.status).toBe(200);
    expect(exported.body.records.find((record) => record.id === corrected.body.id)?.source).toEqual(
      created.source,
    );
    await prisma.medicalDocument.update({
      where: { id: original.id },
      data: { status: 'PENDING' },
    });
    expect(
      (
        await publish({
          ...body,
          publicationKey: randomUUID(),
          expectedDocumentVersion: original.version + 1,
        })
      ).response.status,
    ).toBe(409);
  });

  it('confirma una versión con autoría separada y preserva el cierre al corregir', async () => {
    type Confirmed = RecordResponse & {
      confirmation: {
        actorId: string;
        actorUsername: string;
        capacity: string;
        contentHash: string;
        recordVersion: number;
      } | null;
    };
    const created = await jsonRequest<Confirmed>(baseUrl, `/api/patients/${patientId}/records`, {
      method: 'POST',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        recordType: 'CONSULTATION',
        attendedAt: '2023-09-27',
        attendancePrecision: 'DAY',
        summary: CLINICAL_E2E_PHI.recordSummary,
        details: VALID_RECORD_DETAILS.CONSULTATION,
        professionalId: fixture.clinician.id,
      }),
    });
    expect(created.response.status).toBe(201);
    const confirm = (payload: object, token = peerToken) =>
      jsonRequest<Confirmed>(
        baseUrl,
        `/api/patients/${patientId}/records/${created.body.id}/confirm`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify(payload) },
      );
    const payload = {
      expectedVersion: created.body.version,
      attested: true,
      note: CLINICAL_E2E_PHI.recordNotes,
    };
    expect((await confirm(payload, readerToken)).response.status).toBe(403);
    expect((await confirm({ ...payload, attested: false })).response.status).toBe(400);
    expect((await confirm({ ...payload, expectedVersion: 99 })).response.status).toBe(409);
    const race = await Promise.all([confirm(payload), confirm(payload)]);
    expect(race.map((result) => result.response.status).sort()).toEqual([201, 409]);
    const confirmed = race.find((result) => result.response.status === 201)!.body;
    expect(confirmed.confirmation).toMatchObject({
      actorId: fixture.peerClinician.id,
      actorUsername: fixture.peerClinician.username,
      capacity: 'REVIEWER',
      recordVersion: created.body.version,
    });
    expect(confirmed.confirmation?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const row = await prisma.clinicalRecordConfirmation.findUniqueOrThrow({
      where: { recordId: created.body.id },
    });
    await expect(
      prisma.clinicalRecordConfirmation.update({
        where: { id: row.id },
        data: { note: 'Reemplazo indebido' },
      }),
    ).rejects.toThrow();
    const corrected = await jsonRequest<Confirmed>(
      baseUrl,
      `/api/patients/${patientId}/records/${created.body.id}/correct`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: confirmed.version,
          summary: 'Nueva versión pendiente de revisión explícita',
        }),
      },
    );
    expect(corrected.response.status).toBe(201);
    expect(corrected.body.confirmation).toBeNull();
    expect(
      (await confirm({ ...payload, expectedVersion: confirmed.version + 1 })).response.status,
    ).toBe(409);
    const exported = await jsonRequest<{ records: Confirmed[] }>(
      baseUrl,
      `/api/patients/${patientId}/clinical-history/export`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(
      exported.body.records.find((record) => record.id === created.body.id)?.confirmation,
    ).toEqual(confirmed.confirmation);
    const own = await jsonRequest<Confirmed>(
      baseUrl,
      `/api/patients/${patientId}/records/${corrected.body.id}/confirm`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({ expectedVersion: corrected.body.version, attested: true }),
      },
    );
    expect(own.response.status).toBe(201);
    expect(own.body.confirmation?.capacity).toBe('ORIGINAL_PROFESSIONAL');
  });

  it('agrupa atenciones sin fusionarlas, exige confirmación para cerrar y conserva reaperturas', async () => {
    type Episode = {
      id: string;
      version: number;
      status: string;
      activeCount: number;
      pendingConfirmationCount: number;
    };
    const endpoint = `/api/patients/${patientId}/episodes`;
    const requestEpisode = (path: string, method: string, body: object, token = clinicianToken) =>
      jsonRequest<Episode>(baseUrl, path, {
        method,
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
      });
    const body = {
      title: 'Seguimiento sintético E2E',
      startedOn: '2023-01-01',
      reason: 'Agrupar atenciones sintéticas relacionadas',
    };
    expect((await requestEpisode(endpoint, 'POST', body, readerToken)).response.status).toBe(403);
    expect(
      (await requestEpisode(endpoint, 'POST', { ...body, startedOn: '2023-02-30' })).response
        .status,
    ).toBe(400);
    const created = await requestEpisode(endpoint, 'POST', body);
    expect(created.response.status).toBe(201);
    const id = created.body.id;
    const transition = (version: number, action = 'CLOSE') =>
      requestEpisode(`${endpoint}/${id}/transition`, 'POST', {
        expectedVersion: version,
        action,
        ...(action === 'CLOSE' ? { endedOn: '2023-09-27' } : {}),
        attested: true,
        reason: 'Cambio de estado revisado de prueba',
      });
    expect((await transition(0)).response.status).toBe(409);
    const record = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          recordType: 'CONSULTATION',
          attendedAt: '2023-09-27',
          attendancePrecision: 'DAY',
          summary: CLINICAL_E2E_PHI.recordSummary,
          details: VALID_RECORD_DETAILS.CONSULTATION,
          professionalId: fixture.clinician.id,
        }),
      },
    );
    expect(record.response.status).toBe(201);
    const assignPath = `/api/patients/${patientId}/records/${record.body.id}/episode`;
    const assign = (episodeId: string | null, version: number) =>
      requestEpisode(assignPath, 'PATCH', {
        episodeId,
        expectedRecordVersion: version,
        reason: 'Atención vinculada por seguimiento revisado',
      });
    expect((await assign(randomUUID(), 0)).response.status).toBe(404);
    expect((await assign(id, 0)).response.status).toBe(200);
    expect((await transition(1)).response.status).toBe(409);
    const confirmed = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/${record.body.id}/confirm`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({ expectedVersion: 1, attested: true }),
      },
    );
    expect(confirmed.response.status).toBe(201);
    const closed = await transition(1);
    expect(closed.response.status).toBe(201);
    expect(closed.body.status).toBe('CLOSED');
    expect((await assign(null, confirmed.body.version)).response.status).toBe(409);
    const correctionPath = `/api/patients/${patientId}/records/${record.body.id}/correct`;
    expect(
      (
        await requestEpisode(correctionPath, 'POST', {
          expectedVersion: confirmed.body.version,
          summary: 'Corrección bloqueada por cierre',
        })
      ).response.status,
    ).toBe(409);
    expect(
      (
        await requestEpisode(`/api/patients/${patientId}/records/${record.body.id}/void`, 'PATCH', {
          expectedVersion: confirmed.body.version,
          reason: 'Anulación bloqueada por cierre',
        })
      ).response.status,
    ).toBe(409);
    expect(
      (await prisma.clinicalRecord.findUniqueOrThrow({ where: { id: record.body.id } })).status,
    ).toBe('ACTIVE');
    const reopened = await transition(closed.body.version, 'REOPEN');
    expect(reopened.response.status).toBe(201);
    const corrected = await jsonRequest<
      RecordResponse & { episode: { id: string }; confirmation: null }
    >(baseUrl, correctionPath, {
      method: 'POST',
      headers: jsonHeaders(clinicianToken),
      body: JSON.stringify({
        expectedVersion: confirmed.body.version,
        summary: 'Corrección tras reapertura explícita',
      }),
    });
    expect(corrected.response.status).toBe(201);
    expect(corrected.body.episode.id).toBe(id);
    expect(corrected.body.confirmation).toBeNull();
    const listed = await jsonRequest<{ data: Episode[] }>(baseUrl, endpoint, {
      headers: jsonHeaders(readerToken),
    });
    expect(listed.body.data.find((item) => item.id === id)).toMatchObject({
      activeCount: 1,
      pendingConfirmationCount: 1,
    });
    const history = await jsonRequest<{ data: Array<{ id: string; action: string }> }>(
      baseUrl,
      `${endpoint}/${id}/history`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(history.body.data.map((item) => item.action)).toEqual(
      expect.arrayContaining(['CREATE', 'ATTACH', 'CLOSE', 'REOPEN', 'CORRECT']),
    );
    await expect(
      prisma.clinicalEpisodeEvent.delete({ where: { id: history.body.data[0].id } }),
    ).rejects.toThrow();
    const exported = await jsonRequest<{
      records: Array<{ id: string; episode: { id: string } | null }>;
    }>(baseUrl, `/api/patients/${patientId}/clinical-history/export`, {
      headers: jsonHeaders(readerToken),
    });
    expect(exported.body.records.find((item) => item.id === corrected.body.id)?.episode?.id).toBe(
      id,
    );
  });

  it('administra catálogos con CAS sin reescribir las instantáneas clínicas', async () => {
    type Catalog = { id: string; name: string; version: number; isActive: boolean };
    const body = { kind: 'SPECIALTY', code: 'E2E_ESP', name: 'Especialidad sintética' };
    const create = (payload: object, token = clinicianToken) =>
      jsonRequest<Catalog>(baseUrl, '/api/clinical-catalogs', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify(payload),
      });
    expect((await create(body, readerToken)).response.status).toBe(403);
    const created = await create(body);
    expect(created.response.status).toBe(201);
    expect(
      (await create({ ...body, code: 'E2E_OTRO', name: 'Especialidad sintetica' })).response.status,
    ).toBe(409);
    const record = await jsonRequest<RecordResponse & { specialty: string }>(
      baseUrl,
      `/api/patients/${patientId}/records`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          recordType: 'CONSULTATION',
          attendancePrecision: 'DAY',
          attendedAt: '2023-09-27',
          summary: CLINICAL_E2E_PHI.recordSummary,
          doctorName: 'Profesional sintético',
          specialty: body.name,
          service: 'Servicio histórico externo',
          details: {
            ...VALID_RECORD_DETAILS.CONSULTATION,
            careInstructions: 'Orientación efectivamente documentada',
          },
        }),
      },
    );
    expect(record.response.status).toBe(201);
    const update = (version: number) =>
      jsonRequest<Catalog>(baseUrl, `/api/clinical-catalogs/${created.body.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: version,
          name: 'Nombre nuevo sintético',
          isActive: false,
        }),
      });
    expect((await update(0)).response.status).toBe(200);
    expect((await update(0)).response.status).toBe(409);
    const active = await jsonRequest<{ data: Catalog[] }>(
      baseUrl,
      '/api/clinical-catalogs?kind=SPECIALTY&q=Nombre%20nuevo',
      { headers: jsonHeaders(readerToken) },
    );
    expect(active.body.data).toHaveLength(0);
    const inactive = await jsonRequest<{ data: Catalog[] }>(
      baseUrl,
      '/api/clinical-catalogs?status=INACTIVE&q=Nombre%20nuevo',
      { headers: jsonHeaders(readerToken) },
    );
    expect(inactive.body.data[0]?.id).toBe(created.body.id);
    const exported = await jsonRequest<{
      records: Array<{ id: string; specialty: string; details: { careInstructions: string } }>;
    }>(baseUrl, `/api/patients/${patientId}/clinical-history/export`, {
      headers: jsonHeaders(readerToken),
    });
    const saved = exported.body.records.find((entry) => entry.id === record.body.id);
    expect(saved?.specialty).toBe(body.name);
    expect(saved?.details.careInstructions).toBe('Orientación efectivamente documentada');
  });

  it('busca en todas las páginas, respeta fechas clínicas y limita fuentes según permisos', async () => {
    await prisma.clinicalRecord.createMany({
      data: Array.from({ length: 61 }, (_, index) => ({
        patientId,
        recordType: 'CONSULTATION',
        attendedAt: new Date(index === 60 ? '2021-01-01T05:00:00Z' : '2024-01-01T05:00:00Z'),
        summary: `Zafiro analítico ${index}`,
        details: VALID_RECORD_DETAILS.CONSULTATION as Prisma.InputJsonValue,
        doctorName: 'Profesional de prueba',
        createdBy: fixture.clinician.id,
      })),
    });
    type Page = {
      data: Array<{ id: string; kind: string; preview: string; clinicalFrom: string | null }>;
      total: number;
    };
    const search = (query: string, token = readerToken) =>
      jsonRequest<Page>(baseUrl, `/api/patients/${patientId}/clinical-history/search?${query}`, {
        headers: jsonHeaders(token),
      });
    const first = await search('q=zafiro%20analitico');
    expect(first.response.status).toBe(200);
    expect(first.body.total).toBe(61);
    expect(first.body.data).toHaveLength(20);
    const pages = await Promise.all(
      [2, 3, 4].map((page) => search(`q=zafiro%20analitico&page=${page}`)),
    );
    expect(
      new Set([...first.body.data, ...pages.flatMap((page) => page.body.data)].map((row) => row.id))
        .size,
    ).toBe(61);
    const old = await search('q=zafiro%20analitico%2060');
    expect(old.body.total).toBe(1);
    expect(old.body.data[0].clinicalFrom).toBe('2021-01-01');
    expect((await search('q=zafiro&from=2024-01-01&to=2024-01-01')).body.total).toBe(60);
    expect((await search('from=2024-02-30')).response.status).toBe(400);
    expect((await search('from=2025-01-01&to=2024-01-01')).response.status).toBe(400);
    expect((await search('q=zafiro', limitedToken)).response.status).toBe(403);
    expect((await search('q=%27%20OR%201%3D1%20--')).body.total).toBe(0);
    const original = await uploadMultipart<DocumentResponse>(
      `/api/patients/${patientId}/documents`,
      clinicianToken,
      VALID_PDF,
      'rango-busqueda-e2e.pdf',
      'application/pdf',
    );
    await prisma.medicalDocument.update({
      where: { id: original.body.id },
      data: {
        status: 'VALIDATED',
        correctedText: 'Contenido antiguo zafiro documental',
        clinicalMetadata: { clinicalDate: '2020-01-01', clinicalEndDate: '2022-12-31' },
      },
    });
    expect((await search('q=zafiro%20documental&from=2021-01-01&to=2021-12-31')).body.total).toBe(
      1,
    );
    await prisma.medicalDocument.update({
      where: { id: original.body.id },
      data: { clinicalMetadata: {} },
    });
    expect((await search('q=zafiro%20documental&from=2021-01-01')).body.total).toBe(0);
    await prisma.medicalDocument.update({
      where: { id: original.body.id },
      data: { status: 'PROCESSED' },
    });
    expect((await search('q=zafiro%20documental')).body.total).toBe(0);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: fixture.reader.id } });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: ['patients.read', 'records.read'] } },
    });
    const role = await prisma.role.create({
      data: {
        key: 'E2E_RECORDS_ONLY_SEARCH',
        name: 'Lectura solo de atenciones',
        rolePermissions: { create: permissions.map(({ id }) => ({ permissionId: id })) },
      },
    });
    const user = await prisma.user.create({
      data: {
        email: 'search-records@clinicview.invalid',
        username: 'e2e_search_records',
        firstName: 'Lectura',
        lastName: 'Sintética',
        fullName: 'Lectura Sintética',
        passwordHash: owner.passwordHash,
        userRoles: { create: { roleId: role.id } },
      },
    });
    const token = await login({
      id: user.id,
      email: user.email,
      username: user.username,
      password: fixture.reader.password,
    });
    const scoped = await search('', token);
    expect(scoped.response.status).toBe(200);
    expect(scoped.body.data.every((row) => row.kind === 'RECORD')).toBe(true);
    const overview = await jsonRequest<{
      recordVersions: number;
      activeRecords: number;
      documents: number | null;
      latestClinicalDate: string | null;
    }>(baseUrl, `/api/patients/${patientId}/clinical-history/overview`, {
      headers: jsonHeaders(token),
    });
    expect(overview.response.status).toBe(200);
    expect(overview.body.recordVersions).toBe(
      await prisma.clinicalRecord.count({ where: { patientId } }),
    );
    expect(overview.body.documents).toBeNull();
    expect(overview.body.activeRecords).toBeGreaterThan(60);
    await search(`q=${encodeURIComponent(CLINICAL_E2E_PHI.recordSummary)}`);
  });

  it('exporta selecciones explícitas conservando originales citados y trazabilidad de episodios', async () => {
    type Export = ClinicalHistoryExport & {
      scope: { kind: string; description: string; includesSourceDocumentsOutsidePeriod: boolean };
      episodes: Array<{ id: string; events: Array<{ action: string; actorName: string }> }>;
    };
    const request = (query: string) =>
      jsonRequest<Export>(baseUrl, `/api/patients/${patientId}/clinical-history/export?${query}`, {
        headers: jsonHeaders(readerToken),
      });
    const complete = await request('');
    expect(complete.response.status).toBe(200);
    expect(complete.body.scope.kind).toBe('COMPLETE');
    expect(complete.body.records.length).toBe(
      await prisma.clinicalRecord.count({ where: { patientId } }),
    );
    const source = await prisma.clinicalRecordSource.findFirstOrThrow({
      where: { record: { patientId, status: 'ACTIVE' } },
    });
    await prisma.medicalDocument.update({
      where: { id: source.documentId },
      data: { clinicalMetadata: { clinicalDate: '2020-01-01' }, status: 'PENDING' },
    });
    const selected = await request('from=2023-09-27&to=2023-09-27&versions=CURRENT');
    expect(selected.response.status).toBe(200);
    expect(selected.body.scope).toMatchObject({
      kind: 'FILTERED',
      includesSourceDocumentsOutsidePeriod: true,
    });
    expect(selected.body.records.every((record) => record.status === 'ACTIVE')).toBe(true);
    expect(
      selected.body.documents.find((document) => document.id === source.documentId)?.clinicalText,
    ).toBeNull();
    expect(selected.body.documents.some((document) => document.id === source.documentId)).toBe(
      true,
    );
    const episode = complete.body.episodes[0];
    expect(episode).toBeDefined();
    const grouped = await request(`episodeId=${episode.id}`);
    expect(grouped.body.episodes).toHaveLength(1);
    expect(grouped.body.episodes[0].events.map((event) => event.action)).toEqual(
      expect.arrayContaining(['CREATE', 'CLOSE', 'REOPEN', 'CORRECT']),
    );
    expect(grouped.body.episodes[0].events.every((event) => Boolean(event.actorName))).toBe(true);
    expect(grouped.body.records.length).toBe(
      await prisma.clinicalRecord.count({ where: { patientId, episodeId: episode.id } }),
    );
    expect((await request(`episodeId=${randomUUID()}`)).response.status).toBe(404);
    expect((await request('from=2024-01-01&to=2023-01-01')).response.status).toBe(400);
  });

  it('muestra pendientes personales vivos, paginados y sin confundirlos con notificaciones leídas', async () => {
    type Page = { total: number; data: Array<{ id: string; resourceId: string; kind: string }> };
    const tasks = (query: string, token = clinicianToken) =>
      jsonRequest<Page>(baseUrl, `/api/clinical-work?${query}`, { headers: jsonHeaders(token) });
    const pending = await tasks('kind=CONFIRMATION');
    expect(pending.response.status).toBe(200);
    expect(pending.body.total).toBeGreaterThan(60);
    expect(pending.body.data).toHaveLength(20);
    expect((await tasks('', limitedToken)).body).toMatchObject({ total: 0, data: [] });
    expect((await tasks('kind=CONFIRMATION', peerToken)).body.total).toBe(0);
    const row = await prisma.clinicalRecord.findFirstOrThrow({
      where: { patientId, summary: 'Zafiro analítico 60' },
    });
    const confirmed = await jsonRequest<RecordResponse>(
      baseUrl,
      `/api/patients/${patientId}/records/${row.id}/confirm`,
      {
        method: 'POST',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({ expectedVersion: row.version, attested: true }),
      },
    );
    expect(confirmed.response.status).toBe(201);
    expect((await tasks('kind=CONFIRMATION')).body.total).toBe(pending.body.total - 1);
    const draft = await prisma.clinicalRecordDraft.upsert({
      where: { patientId_actorId: { patientId, actorId: fixture.clinician.id } },
      create: {
        patientId,
        actorId: fixture.clinician.id,
        expiresAt: new Date(Date.now() + 3600000),
      },
      update: { expiresAt: new Date(Date.now() + 3600000) },
    });
    expect((await tasks('kind=DRAFT')).body.data.some((item) => item.resourceId === draft.id)).toBe(
      true,
    );
    expect(
      (await tasks('kind=DRAFT', peerToken)).body.data.some((item) => item.resourceId === draft.id),
    ).toBe(false);
    await prisma.clinicalRecordDraft.update({
      where: { id: draft.id },
      data: { expiresAt: new Date(Date.now() - 10000) },
    });
    expect((await tasks('kind=DRAFT')).body.data.some((item) => item.resourceId === draft.id)).toBe(
      false,
    );
    const assigned = await prisma.medicalDocument.findFirstOrThrow({
      where: { patientId, originalName: 'rango-busqueda-e2e.pdf' },
    });
    await prisma.medicalDocument.update({
      where: { id: assigned.id },
      data: {
        status: 'PROCESSED',
        assignedReviewerId: fixture.clinician.id,
        assignedAt: new Date(),
      },
    });
    expect(
      (await tasks('kind=DOCUMENT')).body.data.some((item) => item.resourceId === assigned.id),
    ).toBe(true);
    expect(
      (await tasks('kind=DOCUMENT', peerToken)).body.data.some(
        (item) => item.resourceId === assigned.id,
      ),
    ).toBe(false);
    await prisma.medicalDocument.update({
      where: { id: assigned.id },
      data: { status: 'VALIDATED' },
    });
    expect(
      (await tasks('kind=DOCUMENT')).body.data.some((item) => item.resourceId === assigned.id),
    ).toBe(false);
  });

  it('preserva OCR espacial privado y revisiones atómicas con procedencia y conflictos reales', async () => {
    const runId = `e2e_${randomUUID()}`;
    const layout = normalizeOcrLayout(runId, [
      {
        page: 1,
        width: 2,
        height: 2,
        coordinateSpace: 'preprocessed_page',
        lines: [
          { lineId: 'line_1', bbox: [0, 0, 2, 1], text: 'OCR uno', order: 1 },
          { lineId: 'line_2', bbox: [0, 1, 2, 2], text: 'OCR dos', order: 2 },
        ],
      },
    ])!;
    iaProcess.mockResolvedValueOnce({
      ocrText: 'OCR uno\nOCR dos',
      entities: [],
      metrics: null,
      ocrConfidence: 0.5,
      confidenceLevel: 'LOW',
      layout,
    });
    const document = await uploadAndProcessDocument('ocr-espacial-sintetico.pdf');
    const path = `/api/patients/${patientId}/documents/${document.id}/ocr-layout`;
    const get = (token = clinicianToken) =>
      jsonRequest<{
        runId: string;
        documentVersion: number;
        pages: Array<{ imageAvailable: boolean }>;
        review: { revision: number; stale: boolean; lines: unknown[] } | null;
      }>(baseUrl, path, { headers: jsonHeaders(token) });
    expect((await fetch(`${baseUrl}${path}`)).status).toBe(401);
    expect((await get(limitedToken)).response.status).toBe(403);
    expect(
      (
        await jsonRequest(
          baseUrl,
          `/api/patients/${randomUUID()}/documents/${document.id}/ocr-layout`,
          { headers: jsonHeaders(clinicianToken) },
        )
      ).response.status,
    ).toBe(404);
    const current = await get(readerToken);
    expect(current.body).toMatchObject({ runId, review: null, pages: [{ imageAvailable: true }] });
    expect(JSON.stringify(current.body)).not.toContain('storagePath');
    const imagePath = `${path}/pages/1/image?runId=${runId}`;
    const image = await fetch(`${baseUrl}${imagePath}`, { headers: jsonHeaders(readerToken) });
    expect(image.status).toBe(200);
    expect(image.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG_2X2);
    expect((await fetch(`${baseUrl}${imagePath}`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}${path}/pages/1/image?runId=other`, {
          headers: jsonHeaders(readerToken),
        })
      ).status,
    ).toBe(404);

    const claim = await claimDocument(document);
    const lines = layout.pages[0].lines.map((line) => ({
      lineId: line.lineId,
      page: 1,
      bbox: line.bbox,
      text: `Revisado ${line.order}`,
      order: line.order,
      reviewed: true,
      sourceLineIds: [line.lineId],
    }));
    const payload = { expectedVersion: claim.version, runId, lines };
    const save = (body: unknown, token = clinicianToken) =>
      jsonRequest(baseUrl, `${path}/review`, {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
      });
    expect((await save(payload, readerToken)).response.status).toBe(403);
    expect((await save(payload, peerToken)).response.status).toBe(409);
    expect((await save({ ...payload, runId: 'stale_run' })).response.status).toBe(409);
    expect((await save({ ...payload, lines: lines.slice(1) })).response.status).toBe(400);
    expect(
      (await save({ ...payload, lines: [{ ...lines[0], bbox: [0, 0, 3, 1] }, lines[1]] })).response
        .status,
    ).toBe(400);
    expect(
      (await prisma.medicalDocument.findUniqueOrThrow({ where: { id: document.id } })).version,
    ).toBe(claim.version);

    const concurrent = await Promise.all([save(payload), save(payload)]);
    expect(concurrent.map((result) => result.response.status).sort()).toEqual([200, 409]);
    const after = await get();
    expect(after.body.review).toMatchObject({ revision: 1, stale: false });
    const savedDoc = await prisma.medicalDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(savedDoc.ocrText).toBe('OCR uno\nOCR dos');
    expect(savedDoc.correctedText).toBe('Revisado 1\nRevisado 2');
    const machine = await prisma.documentOcrRun.findUniqueOrThrow({
      where: { documentId_runId: { documentId: document.id, runId } },
    });
    expect(machine.machineLayout).toEqual(layout);
    expect(await prisma.documentOcrReviewRevision.count({ where: { ocrRunId: machine.id } })).toBe(
      1,
    );
    await expect(
      prisma.documentOcrRun.update({ where: { id: machine.id }, data: { machineLayout: {} } }),
    ).rejects.toThrow('append-only');
    const revision = await prisma.documentOcrReviewRevision.findFirstOrThrow({
      where: { ocrRunId: machine.id },
    });
    await expect(
      prisma.documentOcrReviewRevision.delete({ where: { id: revision.id } }),
    ).rejects.toThrow('append-only');

    const flat = await jsonRequest<DocumentResponse>(
      baseUrl,
      `/api/patients/${patientId}/documents/${document.id}/correction`,
      {
        method: 'PATCH',
        headers: jsonHeaders(clinicianToken),
        body: JSON.stringify({
          expectedVersion: savedDoc.version,
          correctedText: 'Revisión clínica posterior',
        }),
      },
    );
    expect(flat.response.status).toBe(200);
    expect((await get()).body.review?.stale).toBe(true);
    const replacement = { ...payload, expectedVersion: flat.body.version };
    expect((await save(replacement)).response.status).toBe(409);
    expect((await save({ ...replacement, confirmTextReplacement: true })).response.status).toBe(
      200,
    );
    const history = await jsonRequest<{
      previousCorrection: { text: string };
      recordedBy: { username: string };
    }>(baseUrl, `${path}/reviews/2?runId=${runId}`, { headers: jsonHeaders(readerToken) });
    expect(history.response.status).toBe(200);
    expect(history.body.previousCorrection.text).toBe('Revisión clínica posterior');
    expect(history.body.recordedBy.username).toBe(fixture.clinician.username);
    const largeLines = [
      ...lines,
      ...Array.from({ length: 210 }, (_, index) => ({
        lineId: `manual_${index}`,
        page: 1,
        bbox: [0, 0, 1, 1],
        order: index + 3,
        text: '',
        reviewed: false,
        sourceLineIds: [],
        reason: 'Justificación de prueba '.repeat(20),
      })),
    ];
    const largePayload = {
      expectedVersion: (await get()).body.documentVersion,
      runId,
      lines: largeLines,
      confirmTextReplacement: true,
    };
    expect(Buffer.byteLength(JSON.stringify(largePayload))).toBeGreaterThan(100 * 1024);
    expect((await save(largePayload)).response.status).toBe(200);
    const legacy = await uploadAndProcessDocument('ocr-legacy-sintetico.pdf');
    const legacyResponse = await jsonRequest<{ available: boolean }>(
      baseUrl,
      `/api/patients/${patientId}/documents/${legacy.id}/ocr-layout`,
      { headers: jsonHeaders(readerToken) },
    );
    expect(legacyResponse.body.available).toBe(false);
  });

  it('no persiste PHI de payloads clínicos en la bitácora', async () => {
    const events = await prisma.auditEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.some(
        ({ action, outcome }) => action === 'PATIENT_CREATED' && outcome === AuditOutcome.SUCCESS,
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

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { IaClientService } from '../../core/ia/ia-client.service';
import { normalizeOcrLayout } from '../../core/ia/ocr-layout';
import { OcrLayoutService } from './ocr-layout.service';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RUN_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_HASH = 'a'.repeat(64);
const PAGE_HASH = 'b'.repeat(64);

function fixture() {
  const layout = normalizeOcrLayout(RUN_ID, [
    {
      page: 1,
      width: 200,
      height: 200,
      coordinateSpace: 'preprocessed_page',
      lines: [
        {
          lineId: 'l1',
          text: 'Machine one',
          order: 1,
          bbox: [0, 0, 100, 20],
          recognitionStatus: 'recognized',
        },
        {
          lineId: 'l2',
          text: 'Machine two',
          order: 2,
          bbox: [0, 30, 100, 50],
          recognitionStatus: 'recognized',
        },
      ],
    },
    {
      page: 2,
      width: 200,
      height: 200,
      coordinateSpace: 'preprocessed_page',
      lines: [
        {
          lineId: 'l3',
          text: 'Machine joined',
          order: 1,
          bbox: [0, 0, 150, 50],
          recognitionStatus: 'recognized',
        },
      ],
    },
  ])!;
  const lines = [
    {
      lineId: 'merged',
      page: 1,
      order: 1,
      text: 'Reviewed combined',
      bbox: [0, 0, 150, 50],
      sourceLineIds: ['l1', 'l2'],
      reviewed: true,
    },
    {
      lineId: 'split_a',
      page: 2,
      order: 1,
      text: 'Reviewed part A',
      bbox: [0, 0, 150, 20],
      sourceLineIds: ['l3'],
      reviewed: true,
    },
    {
      lineId: 'split_b',
      page: 2,
      order: 2,
      text: 'Reviewed part B',
      bbox: [0, 25, 150, 50],
      sourceLineIds: ['l3'],
      reviewed: true,
    },
    {
      lineId: 'manual',
      page: 2,
      order: 3,
      text: 'Missed region',
      bbox: [0, 70, 150, 100],
      sourceLineIds: [],
      reviewed: true,
      reason: 'Manually found region',
    },
  ];
  const correctedText = lines.map((line) => line.text).join('\n');
  const document = {
    id: 'document',
    patientId: 'patient',
    version: 9,
    status: 'VALIDATED',
    ocrText: 'Latest mutable OCR must never replace the immutable prediction',
    correctedText,
    originalName: 'PRIVATE_PATIENT_FILE.pdf',
  };
  const run = {
    id: 'run-db',
    documentId: 'document',
    runId: RUN_ID,
    machineLayout: layout,
    pageImages: {
      '1': {
        storagePath: 'private/patient/page-one.png',
        sha256: PAGE_HASH,
        width: 200,
        height: 200,
      },
      '2': {
        storagePath: 'private/patient/page-two.png',
        sha256: PAGE_HASH,
        width: 200,
        height: 200,
      },
    },
  };
  const review = {
    revision: 2,
    documentVersion: 8,
    lines,
    correctedText,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    recordedByName: 'PRIVATE_REVIEWER_NAME',
    previousCorrection: { text: 'PRIVATE_PREVIOUS_TEXT' },
  };
  return { document, run, review };
}

describe('OCR evaluation snapshots', () => {
  let data: ReturnType<typeof fixture>;
  let database: {
    medicalDocument: { findFirst: jest.Mock; updateMany: jest.Mock };
    documentOcrRun: { findFirst: jest.Mock; findUnique: jest.Mock };
    documentOcrReviewRevision: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    documentProcessingJob: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { readFile: jest.Mock };
  let service: OcrLayoutService;
  beforeEach(() => {
    data = fixture();
    database = {
      medicalDocument: {
        findFirst: jest.fn().mockResolvedValue(data.document),
        updateMany: jest.fn(),
      },
      documentOcrRun: {
        findUnique: jest.fn().mockResolvedValue(data.run),
        findFirst: jest.fn().mockResolvedValue({ runId: RUN_ID }),
      },
      documentOcrReviewRevision: {
        findUnique: jest.fn().mockResolvedValue(data.review),
        findFirst: jest.fn().mockResolvedValue({ revision: 2 }),
        create: jest.fn(),
      },
      documentProcessingJob: {
        findMany: jest.fn().mockResolvedValue([{ sourceSha256: SOURCE_HASH }]),
      },
      $transaction: jest.fn(),
    };
    database.$transaction.mockImplementation((callback: (tx: typeof database) => unknown) =>
      callback(database),
    );
    storage = { readFile: jest.fn() };
    service = new OcrLayoutService(
      database as unknown as PrismaService,
      storage as unknown as StorageService,
      {} as IaClientService,
    );
  });

  it('exports exact immutable prediction and reviewed draft without modifying clinical records', async () => {
    const before = JSON.stringify(data);
    const snapshot = await service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      kind: 'clinicview-ocr-evaluation-snapshot',
      documentId: 'document',
      runId: RUN_ID,
      revision: 2,
      sourceSha256: SOURCE_HASH,
      provenance: {
        referenceKind: 'ocr_postedited',
        referenceDraft: true,
        pageCoverage: 'unassessed',
        clinicalValidationIsReference: false,
        referenceDocumentVersion: 8,
        currentDocumentVersion: 9,
        currentDocumentStatus: 'VALIDATED',
        isCurrentRun: true,
        isLatestReview: true,
        staleAgainstCurrentCorrection: false,
        reviewRecordedAt: '2026-09-01T12:00:00.000Z',
      },
    });
    expect(snapshot.prediction.pages[0].lines.map((line) => line.text)).toEqual([
      'Machine one',
      'Machine two',
    ]);
    expect(snapshot.prediction.pages[0]).toMatchObject({
      coordinateSpace: 'preprocessed_page',
      imageSha256: PAGE_HASH,
      width: 200,
      height: 200,
    });
    expect(snapshot.review.pages[0].lines[0]).toMatchObject({
      sourceLineIds: ['l1', 'l2'],
      reviewed: true,
    });
    expect(snapshot.review.pages[1].lines.map((line) => line.sourceLineIds)).toEqual([
      ['l3'],
      ['l3'],
      [],
    ]);
    expect(snapshot.review.pages[1].lines[2].bbox).toEqual([0, 70, 150, 100]);
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /PRIVATE_|storagePath|private\/patient|previousCorrection|recordedByName|Latest mutable/,
    );
    expect(database.medicalDocument.updateMany).not.toHaveBeenCalled();
    expect(database.documentOcrReviewRevision.create).not.toHaveBeenCalled();
    expect(storage.readFile).not.toHaveBeenCalled();
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(database.documentOcrRun.findUnique).toHaveBeenCalledWith({
      where: { documentId_runId: { documentId: 'document', runId: RUN_ID } },
    });
    expect(database.documentOcrReviewRevision.findUnique).toHaveBeenCalledWith({
      where: { ocrRunId_revision: { ocrRunId: 'run-db', revision: 2 } },
    });
    expect(database.documentProcessingJob.findMany).toHaveBeenCalledWith({
      where: { documentId: 'document', processingRunId: RUN_ID, status: 'SUCCEEDED' },
      select: { sourceSha256: true },
    });
  });

  it('keeps historical run/revision exportable and flags that it is not the current draft', async () => {
    database.documentOcrRun.findFirst.mockResolvedValue({ runId: OTHER_RUN_ID });
    database.documentOcrReviewRevision.findFirst.mockResolvedValue({ revision: 3 });
    data.document.correctedText = 'New clinical draft';
    const snapshot = await service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2);
    expect(snapshot.provenance).toMatchObject({
      isCurrentRun: false,
      isLatestReview: false,
      staleAgainstCurrentCorrection: true,
    });
    expect(snapshot.review.pages[0].lines[0].text).toBe('Reviewed combined');
  });

  it('flags flat-text staleness without changing the immutable reviewed text', async () => {
    data.document.correctedText = 'Later edit outside spatial review';
    const snapshot = await service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2);
    expect(snapshot.provenance).toMatchObject({
      isCurrentRun: true,
      staleAgainstCurrentCorrection: true,
    });
    expect(snapshot.review.pages[0].lines[0].text).toBe('Reviewed combined');
  });

  it('preserves an explicitly reviewed empty fragment instead of restoring machine text', async () => {
    data.review.lines[0].text = '';
    data.review.correctedText = data.review.lines
      .map((line) => line.text)
      .join('\n')
      .trim();
    const snapshot = await service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2);
    expect(snapshot.review.pages[0].lines[0]).toMatchObject({
      text: '',
      sourceLineIds: ['l1', 'l2'],
      reviewed: true,
    });
    expect(snapshot.prediction.pages[0].lines.map((line) => line.text)).toEqual([
      'Machine one',
      'Machine two',
    ]);
  });

  it('checks patient-document ownership before reading run/revision data', async () => {
    database.medicalDocument.findFirst.mockResolvedValue(null);
    await expect(
      service.getEvaluationSnapshot('other-patient', 'document', RUN_ID, 2),
    ).rejects.toThrow(NotFoundException);
    expect(database.medicalDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'document', patientId: 'other-patient' },
    });
    expect(database.documentOcrRun.findUnique).not.toHaveBeenCalled();
    expect(database.documentProcessingJob.findMany).not.toHaveBeenCalled();
  });

  it.each(['run_legacy', '', '../../private', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'])(
    'rejects invalid/noncanonical run IDs: %s',
    async (runId) => {
      await expect(service.getEvaluationSnapshot('patient', 'document', runId, 2)).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid revisions: %s',
    async (revision) => {
      await expect(
        service.getEvaluationSnapshot('patient', 'document', RUN_ID, revision),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('rejects a missing run', async () => {
    database.documentOcrRun.findUnique.mockResolvedValue(null);
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      NotFoundException,
    );
  });
  it('rejects a missing exact revision', async () => {
    database.documentOcrReviewRevision.findUnique.mockResolvedValue(null);
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      NotFoundException,
    );
  });
  it('rejects a mismatched layout run', async () => {
    data.run.machineLayout.runId = OTHER_RUN_ID;
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      ConflictException,
    );
  });
  it('rejects an unreviewed fragment without promoting clinical validation to reference quality', async () => {
    data.review.lines[0].reviewed = false;
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      ConflictException,
    );
    expect(database.documentProcessingJob.findMany).not.toHaveBeenCalled();
  });
  it('rejects inconsistency between reference fragments and immutable reference text', async () => {
    data.review.correctedText = 'Different text';
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      ConflictException,
    );
  });
  it('rejects dropped original provenance even if the remaining lines were marked reviewed', async () => {
    data.review.lines[0].sourceLineIds = ['l1'];
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      BadRequestException,
    );
  });
  it.each([
    { jobs: [] },
    { jobs: [{ sourceSha256: 'unknown' }] },
    { jobs: [{ sourceSha256: SOURCE_HASH }, { sourceSha256: 'c'.repeat(64) }] },
  ])('rejects missing, malformed or ambiguous source hashes: %j', async ({ jobs }) => {
    database.documentProcessingJob.findMany.mockResolvedValue(jobs);
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      ConflictException,
    );
  });
  it('rejects a missing preserved-page hash instead of silently excluding its page', async () => {
    data.run.pageImages['2'].sha256 = '';
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      ConflictException,
    );
  });
  it('rejects page dimensions inconsistent with the preserved image', async () => {
    data.run.pageImages['1'].width = 100;
    await expect(service.getEvaluationSnapshot('patient', 'document', RUN_ID, 2)).rejects.toThrow(
      ConflictException,
    );
  });
});

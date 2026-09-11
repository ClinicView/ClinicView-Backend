import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { IaClientService } from '../../core/ia/ia-client.service';
import { normalizeOcrLayout } from '../../core/ia/ocr-layout';
import { OcrLayoutService } from './ocr-layout.service';

const layout = normalizeOcrLayout('run_1', [
  {
    page: 1,
    width: 100,
    height: 100,
    coordinateSpace: 'preprocessed_page',
    lines: [{ lineId: 'line_1', text: 'Texto máquina', bbox: [0, 0, 80, 10] }],
  },
])!;
const dto = () => ({
  expectedVersion: 2,
  runId: 'run_1',
  lines: [
    {
      lineId: 'line_1',
      page: 1,
      bbox: [0, 0, 80, 10],
      order: 1,
      text: 'Texto corregido',
      reviewed: true,
      sourceLineIds: ['line_1'],
    },
  ],
});

describe('OcrLayoutService', () => {
  let database: {
    medicalDocument: { findFirst: jest.Mock; updateMany: jest.Mock };
    documentOcrRun: { findFirst: jest.Mock; findUnique: jest.Mock };
    documentOcrReviewRevision: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: OcrLayoutService;
  let storage: { readFile: jest.Mock };
  const document = () => ({
    id: 'doc',
    patientId: 'patient',
    version: 2,
    status: 'PROCESSED',
    assignedReviewerId: 'actor',
    correctedText: null,
    correctedEntities: null,
  });
  const run = () => ({
    id: 'run-db',
    documentId: 'doc',
    runId: 'run_1',
    machineLayout: layout,
    pageImages: {},
    revisions: [],
  });

  beforeEach(() => {
    database = {
      medicalDocument: {
        findFirst: jest.fn().mockResolvedValue(document()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      documentOcrRun: {
        findFirst: jest.fn().mockResolvedValue(run()),
        findUnique: jest.fn().mockResolvedValue(run()),
      },
      documentOcrReviewRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ username: 'reviewer', fullName: 'Revisor Demo', isActive: true }),
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

  it('handles legacy documents without manufacturing line geometry', async () => {
    database.documentOcrRun.findFirst.mockResolvedValue(null);
    await expect(service.getLayout('patient', 'doc')).resolves.toMatchObject({
      available: false,
      runId: null,
      pages: [],
      review: null,
    });
  });
  it('checks document ownership before reading any layout or artifact', async () => {
    database.medicalDocument.findFirst.mockResolvedValue(null);
    await expect(service.getPageImage('other', 'doc', 'run_1', 1)).rejects.toThrow(
      NotFoundException,
    );
    expect(database.medicalDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'doc', patientId: 'other' },
    });
    expect(database.documentOcrRun.findUnique).not.toHaveBeenCalled();
    expect(storage.readFile).not.toHaveBeenCalled();
  });
  it.each([{ version: 3 }, { status: 'VALIDATED' }, { assignedReviewerId: 'other' }])(
    'rejects stale version, wrong state or another assigned reviewer',
    async (overrides) => {
      database.medicalDocument.findFirst.mockResolvedValue({ ...document(), ...overrides });
      await expect(service.saveReview('patient', 'doc', dto(), 'actor')).rejects.toThrow(
        ConflictException,
      );
      expect(database.medicalDocument.updateMany).not.toHaveBeenCalled();
      expect(database.documentOcrReviewRevision.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a stale processing run before touching the document', async () => {
    database.documentOcrRun.findFirst.mockResolvedValue({ ...run(), runId: 'new_run' });
    await expect(service.saveReview('patient', 'doc', dto(), 'actor')).rejects.toThrow(
      ConflictException,
    );
    expect(database.medicalDocument.updateMany).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation to replace an existing corrected text', async () => {
    database.medicalDocument.findFirst.mockResolvedValue({
      ...document(),
      correctedText: 'Revisión clínica previa',
    });
    await expect(service.saveReview('patient', 'doc', dto(), 'actor')).rejects.toThrow(
      ConflictException,
    );
    expect(database.medicalDocument.updateMany).not.toHaveBeenCalled();
  });
  it('preserves previous correction and actor identity in the same transaction as updated text', async () => {
    database.medicalDocument.findFirst.mockResolvedValue({
      ...document(),
      correctedText: 'Versión anterior',
    });
    await service.saveReview('patient', 'doc', { ...dto(), confirmTextReplacement: true }, 'actor');
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.medicalDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 'patient',
          version: 2,
          assignedReviewerId: 'actor',
        }),
        data: expect.objectContaining({
          correctedText: 'Texto corregido',
          version: { increment: 1 },
        }),
      }),
    );
    expect(database.documentOcrReviewRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 1,
        documentVersion: 3,
        recordedByUsername: 'reviewer',
        previousCorrection: expect.objectContaining({
          text: 'Versión anterior',
          documentVersion: 2,
        }),
      }),
    });
  });
  it('does not append a revision when another writer wins compare-and-swap', async () => {
    database.medicalDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.saveReview('patient', 'doc', dto(), 'actor')).rejects.toThrow(
      ConflictException,
    );
    expect(database.documentOcrReviewRevision.create).not.toHaveBeenCalled();
  });
  it('marks the review stale after a flat-text correction and never returns private paths', async () => {
    database.documentOcrRun.findFirst.mockResolvedValue({
      ...run(),
      pageImages: { '1': { storagePath: 'patient/private.png' } },
      revisions: [
        {
          revision: 1,
          documentVersion: 2,
          correctedText: 'Anterior',
          lines: [],
          recordedBy: 'actor',
          recordedByUsername: 'reviewer',
          recordedByName: 'Revisor Demo',
        },
      ],
    });
    const result = await service.getLayout('patient', 'doc');
    expect(result.review?.stale).toBe(true);
    expect(result.pages[0].imageAvailable).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private.png');
  });
  it('checks the preserved page hash and does not proxy an arbitrary path', async () => {
    const bytes = Buffer.from('synthetic');
    database.documentOcrRun.findUnique.mockResolvedValue({
      ...run(),
      pageImages: {
        '1': {
          storagePath: 'private/page.png',
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
    });
    storage.readFile.mockResolvedValue(bytes);
    await expect(service.getPageImage('patient', 'doc', 'run_1', 1)).resolves.toEqual(bytes);
    storage.readFile.mockResolvedValue(Buffer.from('modified'));
    await expect(service.getPageImage('patient', 'doc', 'run_1', 1)).rejects.toThrow(
      NotFoundException,
    );
  });
});

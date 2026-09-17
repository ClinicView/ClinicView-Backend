import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { IaClientService } from '../../core/ia/ia-client.service';
import { normalizeOcrLayout } from '../../core/ia/ocr-layout';
import { OcrLayoutService, OcrPublicationLimitError } from './ocr-layout.service';

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

describe('OcrLayoutService publication acknowledgement and page cleanup', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWNgOP7/PxjDGABdXAsVTWN7aAAAAABJRU5ErkJggg==',
    'base64',
  );
  const onePage = normalizeOcrLayout('run_new', [
    {
      page: 1,
      width: 2,
      height: 2,
      coordinateSpace: 'preprocessed_page',
      lines: [{ lineId: 'line_1', text: 'Synthetic', bbox: [0, 0, 2, 1] }],
    },
  ])!;
  const result = () => ({
    ocrText: 'Synthetic',
    entities: [],
    metrics: null,
    ocrConfidence: 0.5,
    confidenceLevel: 'MEDIUM' as const,
    layout: onePage,
  });
  const fence = { jobId: 'job-new', leaseToken: 'lease-new' };
  let service: OcrLayoutService;
  let database: {
    medicalDocument: { updateMany: jest.Mock };
    documentProcessingJob: { updateMany: jest.Mock };
    documentOcrRun: { create: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { save: jest.Mock; delete: jest.Mock };
  let ia: { getPageImage: jest.Mock };
  beforeEach(() => {
    database = {
      medicalDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      documentProcessingJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      documentOcrRun: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    database.$transaction.mockImplementation((callback: (tx: typeof database) => unknown) =>
      callback(database),
    );
    storage = {
      save: jest.fn().mockResolvedValue('patient/ocr/doc/run_new/new-page.png'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    ia = { getPageImage: jest.fn().mockResolvedValue(png) };
    service = new OcrLayoutService(
      database as unknown as PrismaService,
      storage as unknown as StorageService,
      ia as unknown as IaClientService,
    );
  });

  it('preserves a page referenced by a committed run when the transaction acknowledgement is lost', async () => {
    let published: { pageImages: unknown } | null = null;
    database.documentOcrRun.create.mockImplementation(
      async ({ data }: { data: { pageImages: unknown } }) => {
        published = { pageImages: data.pageImages };
      },
    );
    database.documentOcrRun.findUnique.mockImplementation(async () => published);
    const lost = new Error('Commit acknowledgement lost');
    database.$transaction.mockImplementation(async (callback: (tx: typeof database) => unknown) => {
      await callback(database);
      throw lost;
    });
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
    ).rejects.toBe(lost);
    expect(database.documentOcrRun.create).toHaveBeenCalledTimes(1);
    expect(database.documentOcrRun.findUnique).toHaveBeenCalledWith({
      where: { documentId_runId: { documentId: 'doc', runId: 'run_new' } },
      select: { pageImages: true },
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('preserves pages if the database cannot verify whether publication committed', async () => {
    const original = new Error('Uncertain transaction result');
    database.$transaction.mockRejectedValue(original);
    database.documentOcrRun.findUnique.mockRejectedValue(new Error('Database unavailable'));
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
    ).rejects.toBe(original);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('does not treat a missing row as proof that an uncertain in-flight commit cannot finish', async () => {
    database.$transaction.mockRejectedValue(new Error('Uncertain commit'));
    database.documentOcrRun.findUnique.mockResolvedValue(null);
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
    ).rejects.toThrow('Uncertain commit');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes only its new copy when another immutable run copy won publication', async () => {
    database.$transaction.mockRejectedValue(new Error('Concurrent publication conflict'));
    database.documentOcrRun.findUnique.mockResolvedValue({
      pageImages: {
        '1': { storagePath: 'patient/ocr/doc/run_new/historical-page.png' },
      },
    });
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
    ).rejects.toThrow();
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('patient/ocr/doc/run_new/new-page.png');
  });

  it.each([null, [], { '1': null }, { '1': { storagePath: 42 } }, { '1': { storagePath: '' } }])(
    'preserves new files if persisted page metadata is malformed (%j)',
    async (pageImages) => {
      database.$transaction.mockRejectedValue(new Error('Uncertain transaction'));
      database.documentOcrRun.findUnique.mockResolvedValue({ pageImages });
      await expect(
        service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
      ).rejects.toThrow();
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it('removes an unreferenced page after a locally rejected lease transaction', async () => {
    database.documentProcessingJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
    ).rejects.toThrow(ConflictException);
    expect(database.documentOcrRun.create).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('patient/ocr/doc/run_new/new-page.png');
  });

  it('removes incomplete private copies before any publication was attempted', async () => {
    ia.getPageImage
      .mockResolvedValueOnce(png)
      .mockRejectedValueOnce(new Error('Temporarily unavailable'));
    const twoPages = { ...onePage, pages: [...onePage.pages, { ...onePage.pages[0], page: 2 }] };
    await expect(
      service.completeProcessing(
        'doc',
        'patient',
        4,
        { ...result(), layout: twoPages },
        'actor',
        fence,
      ),
    ).rejects.toThrow('cache incomplete');
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('patient/ocr/doc/run_new/new-page.png');
  });

  it('raises a typed permanent publication limit before caching an oversized response', async () => {
    // Only length is inspected before this early guard: no large allocation or OCR.
    ia.getPageImage.mockResolvedValue({ length: 256 * 1024 * 1024 + 1 });
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor', fence),
    ).rejects.toBeInstanceOf(OcrPublicationLimitError);
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('raises the same limit at an exactly full cache before fetching another page', async () => {
    // Valid PNG with inert trailing bytes, reused for every page: 16 MiB total
    // test memory, not a 256 MiB allocation. Sharp still checks real dimensions.
    const padded = Buffer.concat([png, Buffer.alloc(16 * 1024 * 1024 - png.length)]);
    ia.getPageImage.mockResolvedValue(padded);
    const pages = Array.from({ length: 17 }, (_, index) => ({
      ...onePage.pages[0],
      page: index + 1,
    }));
    await expect(
      service.completeProcessing(
        'doc',
        'patient',
        4,
        { ...result(), layout: { ...onePage, pages } },
        'actor',
        fence,
      ),
    ).rejects.toBeInstanceOf(OcrPublicationLimitError);
    expect(ia.getPageImage).toHaveBeenCalledTimes(16);
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(16);
  });

  it('keeps the legacy partial-cache behavior when no durable job fence exists', async () => {
    ia.getPageImage.mockResolvedValue({ length: 256 * 1024 * 1024 + 1 });
    await expect(
      service.completeProcessing('doc', 'patient', 4, result(), 'actor'),
    ).resolves.toBeUndefined();
    expect(database.documentOcrRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pageImages: {} }),
    });
  });
});

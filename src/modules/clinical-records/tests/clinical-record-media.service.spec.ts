import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClinicalMediaAsset, ClinicalMediaStatus, Prisma } from '@prisma/client';
import type { SharpConstructor } from 'sharp';
import { StorageService } from '../../../core/storage/storage.service';
import { PrismaService } from '../../../database/prisma.service';
import {
  ClinicalRecordMediaService,
  MAX_RECORD_MEDIA_FILE_BYTES,
  RECORD_MEDIA_TTL_MS,
} from '../clinical-record-media.service';
import { MAX_RECORD_ATTACHMENTS_BYTES } from '../dto/record-attachment.dto';
import { ClinicalRecordMediaRepository } from '../repositories/clinical-record-media.repository';

const sharp = jest.requireActual<SharpConstructor>('sharp');
let png1x1: Buffer;
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function withApngControlChunk(png: Buffer): Buffer {
  const ihdrLength = png.readUInt32BE(8);
  const afterIhdr = 8 + 12 + ihdrLength;
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write('acTL', 4, 'ascii');
  chunk.writeUInt32BE(2, 8);
  chunk.writeUInt32BE(0, 12);
  // El CRC no se evalúa: el servicio rechaza el chunk acTL antes de decodificar.
  return Buffer.concat([png.subarray(0, afterIhdr), chunk, png.subarray(afterIhdr)]);
}

const makeAsset = (overrides: Partial<ClinicalMediaAsset> = {}): ClinicalMediaAsset => ({
  id: '10000000-0000-4000-8000-000000000001',
  patientId: '20000000-0000-4000-8000-000000000001',
  uploadedBy: '30000000-0000-4000-8000-000000000001',
  originalName: 'lesión clínica.png',
  storagePath: 'record-media/patient/image.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 640,
  height: 480,
  sha256: 'a'.repeat(64),
  status: ClinicalMediaStatus.TEMPORARY,
  expiresAt: new Date(Date.now() + RECORD_MEDIA_TTL_MS),
  version: 0,
  createdAt: new Date('2026-09-03T12:00:00Z'),
  updatedAt: new Date('2026-09-03T12:00:00Z'),
  ...overrides,
});

const makeFile = (
  buffer: Buffer,
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    fieldname: 'file',
    originalname: 'imagen.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  }) as Express.Multer.File;

const mockRepo = {
  isPatientActive: jest.fn(),
  create: jest.fn(),
  findByIdAndPatient: jest.fn(),
  findManyByIdsAndPatient: jest.fn(),
  transitionTemporaryToAttached: jest.fn(),
  getTemporaryQuota: jest.fn(),
  extendTemporaryExpiry: jest.fn(),
  createAttachments: jest.fn(),
  findExpiredTemporary: jest.fn(),
  deleteTemporaryCas: jest.fn(),
} satisfies Record<keyof ClinicalRecordMediaRepository, jest.Mock>;

const mockStorage = {
  onModuleInit: jest.fn(),
  save: jest.fn(),
  createReadStream: jest.fn(),
  readFile: jest.fn(),
  delete: jest.fn(),
} satisfies Record<keyof StorageService, jest.Mock>;

const mockPrisma = {
  $transaction: jest.fn(),
} as unknown as PrismaService;
const mockTx = {} as Prisma.TransactionClient;

describe('ClinicalRecordMediaService', () => {
  let service: ClinicalRecordMediaService;

  beforeAll(async () => {
    png1x1 = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClinicalRecordMediaService,
        { provide: ClinicalRecordMediaRepository, useValue: mockRepo },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();
    service = module.get(ClinicalRecordMediaService);

    jest.clearAllMocks();
    mockRepo.isPatientActive.mockResolvedValue(true);
    mockRepo.getTemporaryQuota.mockResolvedValue({ count: 0, sizeBytes: 0 });
    mockRepo.transitionTemporaryToAttached.mockResolvedValue(true);
    mockRepo.extendTemporaryExpiry.mockResolvedValue(true);
    mockRepo.createAttachments.mockResolvedValue(undefined);
    mockRepo.findExpiredTemporary.mockResolvedValue([]);
    mockRepo.deleteTemporaryCas.mockResolvedValue(true);
    mockStorage.save.mockImplementation(
      async (_buffer: Buffer, filename: string, subdir: string) => `${subdir}/${filename}`,
    );
    mockStorage.delete.mockResolvedValue(undefined);
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(mockTx),
    );
    mockRepo.create.mockImplementation(
      async (data: Prisma.ClinicalMediaAssetUncheckedCreateInput) =>
        makeAsset({
          ...(data as unknown as Partial<ClinicalMediaAsset>),
          status: data.status ?? ClinicalMediaStatus.TEMPORARY,
          expiresAt: data.expiresAt as Date,
        }),
    );
  });

  describe('upload and image normalization', () => {
    it('detecta el formato por bytes, ignora MIME/extensión y persiste solo la imagen normalizada', async () => {
      const result = await service.upload(
        '20000000-0000-4000-8000-000000000001',
        makeFile(png1x1, {
          originalname: '..\\exploración.pdf',
          mimetype: 'application/pdf',
        }),
        '30000000-0000-4000-8000-000000000001',
      );

      expect(mockStorage.save).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^[0-9a-f]{48}\.png$/),
        'record-media/20000000-0000-4000-8000-000000000001',
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'exploración.pdf',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          status: ClinicalMediaStatus.TEMPORARY,
        }),
        mockTx,
      );
      expect(result.mimeType).toBe('image/png');
      expect(result).not.toHaveProperty('storagePath');
      expect(result).not.toHaveProperty('uploadedBy');
      expect(result.contentUrl).toBe(
        '/patients/20000000-0000-4000-8000-000000000001/record-media/10000000-0000-4000-8000-000000000001/content',
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    it('autorrota y elimina metadata EXIF al recodificar', async () => {
      const oriented = await sharp({
        create: {
          width: 2,
          height: 1,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      await service.upload(
        '20000000-0000-4000-8000-000000000001',
        makeFile(oriented, { originalname: 'foto.jpg', mimetype: 'image/jpeg' }),
        '30000000-0000-4000-8000-000000000001',
      );

      const normalized = mockStorage.save.mock.calls[0]?.[0] as Buffer;
      const metadata = await sharp(normalized).metadata();
      expect(metadata.width).toBe(1);
      expect(metadata.height).toBe(2);
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
    });

    it('rechaza bytes falsos, formatos distintos, archivos grandes y dimensiones excesivas', async () => {
      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(Buffer.from('no es una imagen'), { mimetype: 'image/png' }),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(GIF_1X1, { originalname: 'imagen.png', mimetype: 'image/png' }),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(UnsupportedMediaTypeException);

      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(withApngControlChunk(png1x1)),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(UnsupportedMediaTypeException);

      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(Buffer.alloc(MAX_RECORD_MEDIA_FILE_BYTES + 1)),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      const tooWide = await sharp({
        create: {
          width: 10_001,
          height: 1,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();
      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(tooWide),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorage.save).not.toHaveBeenCalled();
    });

    it('exige actor y paciente activo antes de persistir', async () => {
      await expect(
        service.upload('20000000-0000-4000-8000-000000000001', makeFile(png1x1), ''),
      ).rejects.toThrow(UnauthorizedException);

      mockRepo.isPatientActive.mockResolvedValueOnce(null).mockResolvedValueOnce(false);
      await expect(service.upload('missing', makeFile(png1x1), 'actor')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.upload('inactive', makeFile(png1x1), 'actor')).rejects.toThrow(
        ConflictException,
      );
      expect(mockStorage.save).not.toHaveBeenCalled();
    });

    it('aplica cuota temporal 10/30 MiB antes de guardar', async () => {
      mockRepo.getTemporaryQuota.mockResolvedValueOnce({ count: 10, sizeBytes: 10 });
      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(png1x1),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(ConflictException);

      mockRepo.getTemporaryQuota.mockResolvedValueOnce({
        count: 9,
        sizeBytes: MAX_RECORD_ATTACHMENTS_BYTES,
      });
      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(png1x1),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(mockStorage.save).not.toHaveBeenCalled();
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('retira el archivo si falla la persistencia de metadata', async () => {
      mockRepo.create.mockRejectedValue(new Error('database unavailable'));
      await expect(
        service.upload(
          '20000000-0000-4000-8000-000000000001',
          makeFile(png1x1),
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow('database unavailable');
      expect(mockStorage.delete).toHaveBeenCalledWith(expect.stringContaining('record-media/'));
    });
  });

  describe('private content and deletion', () => {
    it('oculta temporales de otro actor, expirados y de otro paciente', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValueOnce(null);
      await expect(service.getContent('patient', 'asset', 'actor')).rejects.toThrow(
        NotFoundException,
      );

      mockRepo.findByIdAndPatient.mockResolvedValueOnce(makeAsset({ uploadedBy: 'other' }));
      await expect(service.getContent('patient', 'asset', 'actor')).rejects.toThrow(
        NotFoundException,
      );

      mockRepo.findByIdAndPatient.mockResolvedValueOnce(
        makeAsset({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.getContent(
          '20000000-0000-4000-8000-000000000001',
          'asset',
          '30000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockStorage.readFile).not.toHaveBeenCalled();
    });

    it('permite leer un asset ATTACHED con records.read sin exponer ruta', async () => {
      const asset = makeAsset({
        status: ClinicalMediaStatus.ATTACHED,
        expiresAt: null,
        uploadedBy: 'other-actor',
      });
      mockRepo.findByIdAndPatient.mockResolvedValue(asset);
      mockStorage.readFile.mockResolvedValue(png1x1);

      const result = await service.getContent(asset.patientId, asset.id, 'reader');
      expect(result.content).toBe(png1x1);
      expect(result.filename).toBe('lesión clínica.png');
    });

    it('devuelve metadata segura con la misma política de acceso', async () => {
      const asset = makeAsset();
      mockRepo.findByIdAndPatient.mockResolvedValue(asset);

      const result = await service.getMetadata(asset.patientId, asset.id, asset.uploadedBy);
      expect(result).toEqual(
        expect.objectContaining({
          id: asset.id,
          version: 0,
          status: ClinicalMediaStatus.TEMPORARY,
        }),
      );
      expect(result).not.toHaveProperty('storagePath');
      expect(result).not.toHaveProperty('uploadedBy');
    });

    it('borra metadata por CAS antes del storage y no deja fila rota si unlink falla', async () => {
      const events: string[] = [];
      const asset = makeAsset();
      mockRepo.findByIdAndPatient.mockResolvedValue(asset);
      mockRepo.deleteTemporaryCas.mockImplementation(async () => {
        events.push('metadata');
        return true;
      });
      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          const result = await callback(mockTx);
          events.push('commit');
          return result;
        },
      );
      mockStorage.delete.mockImplementation(async () => {
        events.push('storage');
        throw new Error('disk unavailable');
      });

      await expect(
        service.deleteTemporary(asset.patientId, asset.id, 0, asset.uploadedBy),
      ).resolves.toBeUndefined();
      expect(events).toEqual(['metadata', 'commit', 'storage']);
    });

    it('rechaza ownership, ATTACHED, versión obsoleta y pérdida del CAS', async () => {
      const asset = makeAsset();
      mockRepo.findByIdAndPatient.mockResolvedValueOnce({ ...asset, uploadedBy: 'other' });
      await expect(
        service.deleteTemporary(asset.patientId, asset.id, 0, asset.uploadedBy),
      ).rejects.toThrow(NotFoundException);

      mockRepo.findByIdAndPatient.mockResolvedValueOnce({
        ...asset,
        status: ClinicalMediaStatus.ATTACHED,
        expiresAt: null,
      });
      await expect(
        service.deleteTemporary(asset.patientId, asset.id, 0, asset.uploadedBy),
      ).rejects.toThrow(ConflictException);

      mockRepo.findByIdAndPatient.mockResolvedValueOnce({ ...asset, version: 2 });
      await expect(
        service.deleteTemporary(asset.patientId, asset.id, 1, asset.uploadedBy),
      ).rejects.toThrow(ConflictException);

      mockRepo.findByIdAndPatient.mockResolvedValueOnce(asset);
      mockRepo.deleteTemporaryCas.mockResolvedValueOnce(false);
      await expect(
        service.deleteTemporary(asset.patientId, asset.id, 0, asset.uploadedBy),
      ).rejects.toThrow(ConflictException);
      expect(mockStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe('attachment binding and drafts', () => {
    it('normaliza metadata, enlaza temporales y limita tamaño agregado', async () => {
      const first = makeAsset();
      const second = makeAsset({
        id: '10000000-0000-4000-8000-000000000002',
        sizeBytes: 2048,
      });
      mockRepo.findManyByIdsAndPatient.mockResolvedValue([first, second]);

      const result = await service.bindAttachments(
        first.patientId,
        'record-id',
        first.uploadedBy,
        [
          { assetId: first.id, caption: '  Vista frontal  ', altText: '  Lesión frontal  ' },
          { assetId: second.id, sectionKey: 'physicalExam', sortOrder: 5 },
        ],
        new Set(),
        mockTx,
      );

      expect(mockRepo.transitionTemporaryToAttached).toHaveBeenCalledWith(
        [first.id, second.id],
        first.patientId,
        first.uploadedBy,
        expect.any(Date),
        mockTx,
      );
      expect(mockRepo.createAttachments).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            assetId: first.id,
            caption: 'Vista frontal',
            altText: 'Lesión frontal',
            sortOrder: 0,
          }),
          expect.objectContaining({ assetId: second.id, sortOrder: 5 }),
        ],
        mockTx,
      );
      expect(result).toEqual({ count: 2, assetIds: [first.id, second.id] });

      mockRepo.findManyByIdsAndPatient.mockResolvedValue([
        makeAsset({ sizeBytes: MAX_RECORD_ATTACHMENTS_BYTES }),
        second,
      ]);
      await expect(
        service.bindAttachments(
          first.patientId,
          'record-id',
          first.uploadedBy,
          [{ assetId: first.id }, { assetId: second.id }],
          new Set(),
          mockTx,
        ),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('permite reutilizar ATTACHED solo si pertenece al registro original', async () => {
      const attached = makeAsset({ status: ClinicalMediaStatus.ATTACHED, expiresAt: null });
      mockRepo.findManyByIdsAndPatient.mockResolvedValue([attached]);

      await expect(
        service.bindAttachments(
          attached.patientId,
          'correction-id',
          attached.uploadedBy,
          [{ assetId: attached.id }],
          new Set([attached.id]),
          mockTx,
        ),
      ).resolves.toEqual({ count: 1, assetIds: [attached.id] });
      expect(mockRepo.transitionTemporaryToAttached).toHaveBeenCalledWith(
        [],
        attached.patientId,
        attached.uploadedBy,
        expect.any(Date),
        mockTx,
      );

      await expect(
        service.bindAttachments(
          attached.patientId,
          'new-record-id',
          attached.uploadedBy,
          [{ assetId: attached.id }],
          new Set(),
          mockTx,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza duplicados, paciente ajeno, ownership y expiración', async () => {
      const asset = makeAsset();
      await expect(
        service.bindAttachments(
          asset.patientId,
          'record',
          asset.uploadedBy,
          [{ assetId: asset.id }, { assetId: asset.id }],
          new Set(),
          mockTx,
        ),
      ).rejects.toThrow(BadRequestException);

      mockRepo.findManyByIdsAndPatient.mockResolvedValueOnce([]);
      await expect(
        service.bindAttachments(
          asset.patientId,
          'record',
          asset.uploadedBy,
          [{ assetId: asset.id }],
          new Set(),
          mockTx,
        ),
      ).rejects.toThrow(BadRequestException);

      mockRepo.findManyByIdsAndPatient.mockResolvedValueOnce([makeAsset({ uploadedBy: 'other' })]);
      await expect(
        service.bindAttachments(
          asset.patientId,
          'record',
          asset.uploadedBy,
          [{ assetId: asset.id }],
          new Set(),
          mockTx,
        ),
      ).rejects.toThrow(ConflictException);

      mockRepo.findManyByIdsAndPatient.mockResolvedValueOnce([
        makeAsset({ expiresAt: new Date(Date.now() - 1000) }),
      ]);
      await expect(
        service.bindAttachments(
          asset.patientId,
          'record',
          asset.uploadedBy,
          [{ assetId: asset.id }],
          new Set(),
          mockTx,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('renueva atómicamente el TTL de assets referidos por el borrador', async () => {
      const asset = makeAsset();
      const draftExpiresAt = new Date(Date.now() + RECORD_MEDIA_TTL_MS);
      mockRepo.findManyByIdsAndPatient.mockResolvedValue([asset]);

      await expect(
        service.validateDraftAttachments(
          asset.patientId,
          asset.uploadedBy,
          [{ assetId: asset.id, caption: '  Control  ' }],
          draftExpiresAt,
          mockTx,
        ),
      ).resolves.toEqual([expect.objectContaining({ assetId: asset.id, caption: 'Control' })]);
      expect(mockRepo.extendTemporaryExpiry).toHaveBeenCalledWith(
        [asset.id],
        asset.patientId,
        asset.uploadedBy,
        expect.any(Date),
        draftExpiresAt,
        mockTx,
      );

      mockRepo.extendTemporaryExpiry.mockResolvedValueOnce(false);
      await expect(
        service.validateDraftAttachments(
          asset.patientId,
          asset.uploadedBy,
          [{ assetId: asset.id }],
          draftExpiresAt,
          mockTx,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('expiration purge', () => {
    it('reclama por CAS, elimina metadata y después limpia storage idempotentemente', async () => {
      const expired = makeAsset({ expiresAt: new Date(Date.now() - 1000) });
      const events: string[] = [];
      mockRepo.findExpiredTemporary.mockResolvedValue([expired]);
      mockRepo.deleteTemporaryCas.mockImplementation(async () => {
        events.push('metadata');
        return true;
      });
      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          const result = await callback(mockTx);
          events.push('commit');
          return result;
        },
      );
      mockStorage.delete.mockImplementation(async () => {
        events.push('storage');
      });

      await expect(service.purgeExpiredTemporaryAssets()).resolves.toBe(1);
      expect(events).toEqual(['metadata', 'commit', 'storage']);
      expect(mockRepo.deleteTemporaryCas).toHaveBeenCalledWith(expired, mockTx, expect.any(Date));
    });
  });
});

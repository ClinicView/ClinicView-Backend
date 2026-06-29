import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentStatus } from '@prisma/client';
import { IaClientService } from '../../../core/ia/ia-client.service';
import { StorageService } from '../../../core/storage/storage.service';
import { MedicalDocumentsService } from '../medical-documents.service';
import { MedicalDocumentsRepository } from '../repositories/medical-documents.repository';

const makeDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-uuid',
  patientId: 'patient-uuid',
  originalName: 'informe.pdf',
  storagePath: 'patient-uuid/abc123.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 102400,
  status: DocumentStatus.PENDING,
  ocrText: null,
  nerEntities: null,
  correctedText: null,
  correctedEntities: null,
  correctedAt: null,
  correctedById: null,
  rejectReason: null,
  processedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  createdAt: new Date(),
  createdBy: 'user-uuid',
  updatedAt: new Date(),
  updatedBy: null,
  version: 0,
  ...overrides,
});

const mockFile: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'informe.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('PDF content'),
  size: 102400,
  stream: null as never,
  destination: '',
  filename: '',
  path: '',
};

const mockRepo = {
  create: jest.fn(),
  findByPatient: jest.fn(),
  findByIdAndPatient: jest.fn(),
  updateStatus: jest.fn(),
  saveCorrection: jest.fn(),
} satisfies Record<keyof MedicalDocumentsRepository, jest.Mock>;

const mockStorage = {
  save: jest.fn(),
  createReadStream: jest.fn(),
  delete: jest.fn(),
  onModuleInit: jest.fn(),
} satisfies Record<keyof StorageService, jest.Mock>;

const mockIaClient = {
  process: jest.fn(),
} satisfies Record<keyof IaClientService, jest.Mock>;

describe('MedicalDocumentsService', () => {
  let service: MedicalDocumentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicalDocumentsService,
        { provide: MedicalDocumentsRepository, useValue: mockRepo },
        { provide: StorageService, useValue: mockStorage },
        { provide: IaClientService, useValue: mockIaClient },
      ],
    }).compile();

    service = module.get(MedicalDocumentsService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('guarda el archivo y crea el registro en BD', async () => {
      const doc = makeDoc();
      mockStorage.save.mockResolvedValue('patient-uuid/abc123.pdf');
      mockRepo.create.mockResolvedValue(doc);

      const result = await service.upload('patient-uuid', mockFile, 'user-uuid');

      expect(mockStorage.save).toHaveBeenCalledWith(
        mockFile.buffer,
        expect.stringMatching(/\.pdf$/),
        'patient-uuid',
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-uuid',
          mimeType: 'application/pdf',
          originalName: 'informe.pdf',
          createdBy: 'user-uuid',
        }),
      );
      expect(result.id).toBe('doc-uuid');
      expect(result.status).toBe(DocumentStatus.PENDING);
    });

    it('rechaza MIME types no permitidos', async () => {
      const badFile = { ...mockFile, mimetype: 'text/plain' };
      await expect(service.upload('patient-uuid', badFile, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
      expect(mockStorage.save).not.toHaveBeenCalled();
    });
  });

  describe('findByPatient', () => {
    it('devuelve documentos paginados', async () => {
      mockRepo.findByPatient.mockResolvedValue({ documents: [makeDoc()], total: 1 });
      const result = await service.findByPatient('patient-uuid', {});
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('devuelve el documento si existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeDoc());
      const result = await service.findOne('patient-uuid', 'doc-uuid');
      expect(result.id).toBe('doc-uuid');
    });

    it('lanza NotFoundException si no existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(null);
      await expect(service.findOne('patient-uuid', 'no-existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('process', () => {
    it('lanza NotFoundException si el documento no existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(null);
      await expect(service.process('patient-uuid', 'no-existe')).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si el estado no es PENDING ni FAILED', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeDoc({ status: DocumentStatus.VALIDATED }));
      await expect(service.process('patient-uuid', 'doc-uuid')).rejects.toThrow(ConflictException);
    });

    it('actualiza a PROCESSED cuando el worker IA tiene éxito', async () => {
      const doc = makeDoc();
      mockRepo.findByIdAndPatient.mockResolvedValue(doc);
      mockRepo.updateStatus
        .mockResolvedValueOnce({ ...doc, status: DocumentStatus.PROCESSING })
        .mockResolvedValueOnce({ ...doc, status: DocumentStatus.PROCESSED, ocrText: 'texto extraído' });

      mockIaClient.process.mockResolvedValue({ ocrText: 'texto extraído', entities: [] });

      const result = await service.process('patient-uuid', 'doc-uuid', 'user-uuid');

      expect(mockRepo.updateStatus).toHaveBeenCalledWith(
        'doc-uuid',
        DocumentStatus.PROCESSING,
        expect.anything(),
      );
      expect(result.status).toBe(DocumentStatus.PROCESSED);
    });

    it('actualiza a FAILED cuando el worker de IA falla', async () => {
      const doc = makeDoc();
      mockRepo.findByIdAndPatient.mockResolvedValue(doc);
      mockRepo.updateStatus
        .mockResolvedValueOnce({ ...doc, status: DocumentStatus.PROCESSING })
        .mockResolvedValueOnce({ ...doc, status: DocumentStatus.FAILED });

      mockIaClient.process.mockRejectedValue(new Error('IA no disponible'));

      const result = await service.process('patient-uuid', 'doc-uuid');
      expect(result.status).toBe(DocumentStatus.FAILED);
    });
  });

  describe('validate', () => {
    it('valida un documento PROCESSED', async () => {
      const doc = makeDoc({ status: DocumentStatus.PROCESSED });
      const validated = makeDoc({ status: DocumentStatus.VALIDATED, reviewedAt: new Date() });
      mockRepo.findByIdAndPatient.mockResolvedValue(doc);
      mockRepo.updateStatus.mockResolvedValue(validated);

      const result = await service.validate('patient-uuid', 'doc-uuid', 'user-uuid');
      expect(mockRepo.updateStatus).toHaveBeenCalledWith(
        'doc-uuid',
        DocumentStatus.VALIDATED,
        expect.objectContaining({ reviewedBy: 'user-uuid' }),
      );
      expect(result.status).toBe(DocumentStatus.VALIDATED);
    });

    it('lanza ConflictException si el estado no es PROCESSED', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeDoc({ status: DocumentStatus.PENDING }));
      await expect(service.validate('patient-uuid', 'doc-uuid')).rejects.toThrow(ConflictException);
    });
  });

  describe('saveCorrection', () => {
    it('guarda texto y entidades corregidas sin sobrescribir OCR original', async () => {
      const doc = makeDoc({
        status: DocumentStatus.PROCESSED,
        ocrText: 'texto OCR',
        nerEntities: [{ type: 'OBSERVATION', value: 'valor original', confidence: 0.4 }],
      });
      const corrected = makeDoc({
        ...doc,
        correctedText: 'texto corregido',
        correctedEntities: [{ type: 'OBSERVATION', value: 'valor corregido' }],
        correctedAt: new Date(),
        correctedById: 'user-uuid',
      });
      mockRepo.findByIdAndPatient.mockResolvedValue(doc);
      mockRepo.saveCorrection.mockResolvedValue(corrected);

      const result = await service.saveCorrection(
        'patient-uuid',
        'doc-uuid',
        {
          correctedText: ' texto corregido ',
          correctedEntities: [{ type: 'OBSERVATION', value: 'valor corregido' }],
        },
        'user-uuid',
      );

      expect(mockRepo.saveCorrection).toHaveBeenCalledWith(
        'doc-uuid',
        expect.objectContaining({
          correctedText: 'texto corregido',
          correctedById: 'user-uuid',
          updatedBy: 'user-uuid',
        }),
      );
      expect(result.ocrText).toBe('texto OCR');
      expect(result.correctedText).toBe('texto corregido');
    });

    it('lanza ConflictException si el documento no esta PROCESSED', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeDoc({ status: DocumentStatus.PENDING }));
      await expect(
        service.saveCorrection('patient-uuid', 'doc-uuid', { correctedText: 'texto' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    it('rechaza un documento PROCESSED con motivo', async () => {
      const doc = makeDoc({ status: DocumentStatus.PROCESSED });
      const rejected = makeDoc({ status: DocumentStatus.REJECTED, rejectReason: 'Documento ilegible por baja resolución.' });
      mockRepo.findByIdAndPatient.mockResolvedValue(doc);
      mockRepo.updateStatus.mockResolvedValue(rejected);

      const result = await service.reject(
        'patient-uuid',
        'doc-uuid',
        { reason: 'Documento ilegible por baja resolución.' },
        'user-uuid',
      );
      expect(result.status).toBe(DocumentStatus.REJECTED);
      expect(result.rejectReason).toBe('Documento ilegible por baja resolución.');
    });

    it('lanza ConflictException si el estado no es PROCESSED ni PENDING', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeDoc({ status: DocumentStatus.VALIDATED }));
      await expect(
        service.reject('patient-uuid', 'doc-uuid', { reason: 'Motivo de rechazo largo.' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RecordOrigin, RecordStatus, RecordType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ClinicalRecordsService } from '../clinical-records.service';
import { ClinicalRecordsRepository } from '../repositories/clinical-records.repository';

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'record-uuid',
  patientId: 'patient-uuid',
  recordType: RecordType.CONSULTATION,
  origin: RecordOrigin.MANUAL,
  status: RecordStatus.ACTIVE,
  attendedAt: new Date('2026-06-01T10:00:00Z'),
  summary: 'Paciente en buen estado general.',
  notes: null,
  parentRecordId: null,
  voidReason: null,
  createdAt: new Date(),
  createdBy: null,
  updatedAt: new Date(),
  updatedBy: null,
  version: 0,
  _count: { corrections: 0 },
  ...overrides,
});

const mockRepo = {
  create: jest.fn(),
  findByPatient: jest.fn(),
  findByIdAndPatient: jest.fn(),
  markCorrected: jest.fn(),
  createInTransaction: jest.fn(),
  markVoided: jest.fn(),
} satisfies Record<keyof ClinicalRecordsRepository, jest.Mock>;

const mockPrisma = {
  $transaction: jest.fn(),
} as unknown as PrismaService;

describe('ClinicalRecordsService', () => {
  let service: ClinicalRecordsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClinicalRecordsService,
        { provide: ClinicalRecordsRepository, useValue: mockRepo },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(ClinicalRecordsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('crea un registro y devuelve la respuesta mapeada', async () => {
      const record = makeRecord();
      mockRepo.create.mockResolvedValue(record);

      const result = await service.create(
        'patient-uuid',
        {
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-06-01T10:00:00Z',
          summary: 'Paciente en buen estado general.',
        },
        'user-uuid',
      );

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-uuid',
          recordType: RecordType.CONSULTATION,
          origin: RecordOrigin.MANUAL,
          createdBy: 'user-uuid',
        }),
      );
      expect(result.correctionsCount).toBe(0);
      expect(result.id).toBe('record-uuid');
    });

    it('aplica origin MANUAL por defecto', async () => {
      mockRepo.create.mockResolvedValue(makeRecord());
      await service.create('patient-uuid', {
        recordType: RecordType.LAB_RESULT,
        attendedAt: '2026-06-01T10:00:00Z',
        summary: 'Resultado de glucosa.',
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ origin: RecordOrigin.MANUAL }),
      );
    });
  });

  describe('findByPatient', () => {
    it('devuelve datos paginados', async () => {
      const record = makeRecord();
      mockRepo.findByPatient.mockResolvedValue({ records: [record], total: 1 });

      const result = await service.findByPatient('patient-uuid', { page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('usa page 1 y limit 20 por defecto', async () => {
      mockRepo.findByPatient.mockResolvedValue({ records: [], total: 0 });
      await service.findByPatient('patient-uuid', {});
      expect(mockRepo.findByPatient).toHaveBeenCalledWith(
        'patient-uuid',
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });
  });

  describe('findOne', () => {
    it('devuelve el registro si existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord());
      const result = await service.findOne('patient-uuid', 'record-uuid');
      expect(result.id).toBe('record-uuid');
    });

    it('lanza NotFoundException si no existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(null);
      await expect(service.findOne('patient-uuid', 'no-existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('correct', () => {
    it('lanza NotFoundException si el registro original no existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(null);
      await expect(
        service.correct('patient-uuid', 'no-existe', { summary: 'Corrección' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si el registro no está ACTIVE', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(
        makeRecord({ status: RecordStatus.VOIDED }),
      );
      await expect(
        service.correct('patient-uuid', 'record-uuid', { summary: 'Corrección' }),
      ).rejects.toThrow(ConflictException);
    });

    it('ejecuta la transacción y devuelve el nuevo registro', async () => {
      const original = makeRecord();
      const newRecord = makeRecord({
        id: 'new-record-uuid',
        parentRecordId: 'record-uuid',
        summary: 'Corrección del registro.',
      });
      mockRepo.findByIdAndPatient.mockResolvedValue(original);

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
      mockRepo.markCorrected.mockResolvedValue(undefined);
      mockRepo.createInTransaction.mockResolvedValue(newRecord);

      const result = await service.correct(
        'patient-uuid',
        'record-uuid',
        { summary: 'Corrección del registro.' },
        'user-uuid',
      );

      expect(mockRepo.markCorrected).toHaveBeenCalledWith('record-uuid', 'user-uuid', expect.anything());
      expect(mockRepo.createInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ parentRecordId: 'record-uuid', summary: 'Corrección del registro.' }),
        expect.anything(),
      );
      expect(result.id).toBe('new-record-uuid');
    });

    it('hereda attendedAt del original si no se provee en el DTO', async () => {
      const original = makeRecord();
      const newRecord = makeRecord({ id: 'new-uuid', parentRecordId: 'record-uuid', summary: 'Fix' });
      mockRepo.findByIdAndPatient.mockResolvedValue(original);
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
      mockRepo.markCorrected.mockResolvedValue(undefined);
      mockRepo.createInTransaction.mockResolvedValue(newRecord);

      await service.correct('patient-uuid', 'record-uuid', { summary: 'Fix' }, 'user-uuid');

      expect(mockRepo.createInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ attendedAt: original.attendedAt }),
        expect.anything(),
      );
    });
  });

  describe('void', () => {
    it('lanza NotFoundException si el registro no existe', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(null);
      await expect(
        service.void('patient-uuid', 'no-existe', { reason: 'Ingreso duplicado por error.' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si el registro no está ACTIVE', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord({ status: RecordStatus.CORRECTED }));
      await expect(
        service.void('patient-uuid', 'record-uuid', { reason: 'Ingreso duplicado por error.' }),
      ).rejects.toThrow(ConflictException);
    });

    it('anula el registro con la razón dada', async () => {
      const record = makeRecord();
      const voided = { ...record, status: RecordStatus.VOIDED, voidReason: 'Ingreso duplicado por error.' };
      mockRepo.findByIdAndPatient.mockResolvedValue(record);
      mockRepo.markVoided.mockResolvedValue(voided);

      const result = await service.void(
        'patient-uuid',
        'record-uuid',
        { reason: 'Ingreso duplicado por error.' },
        'user-uuid',
      );

      expect(mockRepo.markVoided).toHaveBeenCalledWith(
        'record-uuid',
        'Ingreso duplicado por error.',
        'user-uuid',
      );
      expect(result.status).toBe(RecordStatus.VOIDED);
      expect(result.voidReason).toBe('Ingreso duplicado por error.');
    });
  });
});

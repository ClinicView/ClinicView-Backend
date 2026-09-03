import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, RecordOrigin, RecordStatus, RecordType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ClinicalRecordsService } from '../clinical-records.service';
import { ClinicalRecordsRepository } from '../repositories/clinical-records.repository';

const consultationDetails = {
  chiefComplaint: 'Dolor abdominal de dos días de evolución.',
  physicalExam: 'Abdomen blando y depresible.',
};

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'record-uuid',
  patientId: 'patient-uuid',
  recordType: RecordType.CONSULTATION,
  origin: RecordOrigin.MANUAL,
  status: RecordStatus.ACTIVE,
  attendedAt: new Date('2026-06-01T10:00:00Z'),
  summary: 'Paciente en buen estado general.',
  notes: null,
  details: consultationDetails,
  schemaVersion: 1,
  doctorName: 'Dra. Elena Rivera',
  professionalId: '10000000-0000-4000-8000-000000000001',
  professionalNameSnapshot: 'Dra. Elena Rivera',
  professionalLicenseSnapshot: 'CMP 12345',
  service: 'Medicina general',
  preliminaryDiagnosis: null,
  plan: 'Control en siete días.',
  priority: 'NORMAL',
  parentRecordId: null,
  voidReason: null,
  createdAt: new Date('2026-06-01T10:05:00Z'),
  createdBy: 'user-uuid',
  updatedAt: new Date('2026-06-01T10:05:00Z'),
  updatedBy: null,
  version: 0,
  _count: { corrections: 0 },
  ...overrides,
});

const makeDraft = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft-uuid',
  patientId: 'patient-uuid',
  actorId: 'user-uuid',
  payload: { recordType: RecordType.CONSULTATION, details: { chiefComplaint: 'Dolor' } },
  version: 0,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockRepo = {
  create: jest.fn(),
  findByPatient: jest.fn(),
  findByIdAndPatient: jest.fn(),
  markCorrected: jest.fn(),
  createInTransaction: jest.fn(),
  markVoided: jest.fn(),
  findDraftByActorAndPatient: jest.fn(),
  createDraft: jest.fn(),
  updateDraftCas: jest.fn(),
  deleteDraftCas: jest.fn(),
  deleteDraftByIdForActor: jest.fn(),
  deleteDraftById: jest.fn(),
} satisfies Record<keyof ClinicalRecordsRepository, jest.Mock>;

const mockTx = {
  patient: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
} as unknown as Prisma.TransactionClient;

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
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(mockTx),
    );
    (mockTx.patient.findUnique as jest.Mock).mockResolvedValue({ isActive: true });
    (mockTx.user.findUnique as jest.Mock).mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      fullName: 'Dra. Elena Rivera',
      isActive: true,
    });
  });

  describe('create', () => {
    it('crea un registro tipado, fuerza origen MANUAL y captura la identidad profesional', async () => {
      mockRepo.createInTransaction.mockResolvedValue(makeRecord());

      const result = await service.create(
        'patient-uuid',
        {
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-06-01T10:00:00Z',
          summary: '  Paciente en buen estado general.  ',
          professionalId: '10000000-0000-4000-8000-000000000001',
          professionalLicense: ' CMP 12345 ',
          details: consultationDetails,
        },
        'user-uuid',
      );

      expect(mockRepo.createInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-uuid',
          origin: RecordOrigin.MANUAL,
          summary: 'Paciente en buen estado general.',
          details: consultationDetails,
          schemaVersion: 1,
          professionalId: '10000000-0000-4000-8000-000000000001',
          professionalNameSnapshot: 'Dra. Elena Rivera',
          professionalLicenseSnapshot: 'CMP 12345',
          createdBy: 'user-uuid',
        }),
        mockTx,
      );
      expect(result.details).toEqual(consultationDetails);
      expect(result.version).toBe(0);
    });

    it('ignora cualquier origin inyectado por una llamada interna y conserva MANUAL', async () => {
      mockRepo.createInTransaction.mockResolvedValue(makeRecord());
      await service.create(
        'patient-uuid',
        {
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-06-01T10:00:00Z',
          summary: 'Control clínico.',
          details: consultationDetails,
          origin: RecordOrigin.DIGITIZED,
        } as never,
        'user-uuid',
      );
      expect(mockRepo.createInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ origin: RecordOrigin.MANUAL }),
        mockTx,
      );
    });

    it('rechaza details que no corresponden al tipo', async () => {
      await expect(
        service.create(
          'patient-uuid',
          {
            recordType: RecordType.PRESCRIPTION,
            attendedAt: '2026-06-01T10:00:00Z',
            summary: 'Receta.',
            details: consultationDetails,
          },
          'user-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('exige actor autenticado incluso en llamadas internas', async () => {
      await expect(
        service.create(
          'patient-uuid',
          {
            recordType: RecordType.CONSULTATION,
            attendedAt: '2026-06-01T10:00:00Z',
            summary: 'Control.',
            details: consultationDetails,
          },
          '',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza crear registros para un paciente inactivo', async () => {
      (mockTx.patient.findUnique as jest.Mock).mockResolvedValue({ isActive: false });
      await expect(
        service.create(
          'patient-uuid',
          {
            recordType: RecordType.CONSULTATION,
            attendedAt: '2026-06-01T10:00:00Z',
            summary: 'Control.',
            details: consultationDetails,
          },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockRepo.createInTransaction).not.toHaveBeenCalled();
    });

    it('consume el borrador del mismo actor dentro de la transacción', async () => {
      mockRepo.createInTransaction.mockResolvedValue(makeRecord());
      mockRepo.deleteDraftByIdForActor.mockResolvedValue(true);

      await service.create(
        'patient-uuid',
        {
          recordType: RecordType.CONSULTATION,
          attendedAt: '2026-06-01T10:00:00Z',
          summary: 'Control.',
          details: consultationDetails,
          draftId: '20000000-0000-4000-8000-000000000001',
        },
        'user-uuid',
      );

      expect(mockRepo.deleteDraftByIdForActor).toHaveBeenCalledWith(
        '20000000-0000-4000-8000-000000000001',
        'patient-uuid',
        'user-uuid',
        mockTx,
      );
    });

    it('aborta si el draftId no es vigente o no pertenece al actor', async () => {
      mockRepo.createInTransaction.mockResolvedValue(makeRecord());
      mockRepo.deleteDraftByIdForActor.mockResolvedValue(false);
      await expect(
        service.create(
          'patient-uuid',
          {
            recordType: RecordType.CONSULTATION,
            attendedAt: '2026-06-01T10:00:00Z',
            summary: 'Control.',
            details: consultationDetails,
            draftId: '20000000-0000-4000-8000-000000000001',
          },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reads', () => {
    it('devuelve datos paginados y tolera details vacío de registros históricos', async () => {
      const record = makeRecord({ details: {} });
      mockRepo.findByPatient.mockResolvedValue({ records: [record], total: 1 });

      const result = await service.findByPatient('patient-uuid', { page: 1, limit: 20 });

      expect(result.data[0]?.details).toEqual({});
      expect(result.total).toBe(1);
    });

    it('convierte un rango date-only al día completo de America/Lima', async () => {
      mockRepo.findByPatient.mockResolvedValue({ records: [], total: 0 });
      await service.findByPatient('patient-uuid', {
        from: '2026-09-02',
        to: '2026-09-02',
      });
      expect(mockRepo.findByPatient).toHaveBeenCalledWith(
        'patient-uuid',
        expect.objectContaining({
          from: new Date('2026-09-02T05:00:00.000Z'),
          to: new Date('2026-09-03T05:00:00.000Z'),
          toExclusive: true,
        }),
      );
    });

    it('lanza NotFoundException al consultar un registro inexistente', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(null);
      await expect(service.findOne('patient-uuid', 'no-existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('correct', () => {
    it('corrige todos los campos y cambia plantilla sin perder procedencia', async () => {
      const original = makeRecord({ origin: RecordOrigin.DIGITIZED, version: 4 });
      const corrected = makeRecord({
        id: 'new-record-uuid',
        recordType: RecordType.PROCEDURE,
        origin: RecordOrigin.DIGITIZED,
        parentRecordId: 'record-uuid',
        details: {
          procedureName: 'Curación de herida',
          technique: 'Lavado y cobertura estéril.',
          complications: 'Sin complicaciones.',
        },
      });
      mockRepo.findByIdAndPatient.mockResolvedValue(original);
      mockRepo.markCorrected.mockResolvedValue(true);
      mockRepo.createInTransaction.mockResolvedValue(corrected);

      const result = await service.correct(
        'patient-uuid',
        'record-uuid',
        {
          expectedVersion: 4,
          recordType: RecordType.PROCEDURE,
          summary: 'Procedimiento corregido.',
          notes: null,
          service: 'Cirugía ambulatoria',
          preliminaryDiagnosis: null,
          plan: 'Control en 48 horas.',
          priority: 'PRIORITY',
          details: {
            procedureName: 'Curación de herida',
            technique: 'Lavado y cobertura estéril.',
            complications: 'Sin complicaciones.',
          },
        },
        'user-uuid',
      );

      expect(mockRepo.markCorrected).toHaveBeenCalledWith(
        'record-uuid',
        'patient-uuid',
        4,
        'user-uuid',
        mockTx,
      );
      expect(mockRepo.createInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          recordType: RecordType.PROCEDURE,
          origin: RecordOrigin.DIGITIZED,
          notes: null,
          preliminaryDiagnosis: null,
          parentRecordId: 'record-uuid',
          createdBy: 'user-uuid',
        }),
        mockTx,
      );
      expect(result.id).toBe('new-record-uuid');
    });

    it('permite corregir un registro histórico details={} heredándolo', async () => {
      const original = makeRecord({ details: {}, version: 2 });
      mockRepo.findByIdAndPatient.mockResolvedValue(original);
      mockRepo.markCorrected.mockResolvedValue(true);
      mockRepo.createInTransaction.mockResolvedValue(makeRecord({ id: 'new-id', details: {} }));

      await service.correct(
        'patient-uuid',
        'record-uuid',
        { expectedVersion: 2, summary: 'Resumen histórico corregido.' },
        'user-uuid',
      );

      expect(mockRepo.createInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ details: {}, recordType: RecordType.CONSULTATION }),
        mockTx,
      );
    });

    it('rechaza una versión obsoleta antes de mutar', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord({ version: 3 }));
      await expect(
        service.correct(
          'patient-uuid',
          'record-uuid',
          { expectedVersion: 2, summary: 'Corrección.' },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockRepo.markCorrected).not.toHaveBeenCalled();
    });

    it('rechaza la carrera si el CAS falla dentro de la transacción', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord({ version: 1 }));
      mockRepo.markCorrected.mockResolvedValue(false);
      await expect(
        service.correct(
          'patient-uuid',
          'record-uuid',
          { expectedVersion: 1, summary: 'Corrección.' },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockRepo.createInTransaction).not.toHaveBeenCalled();
    });

    it('exige details al cambiar recordType', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord());
      await expect(
        service.correct(
          'patient-uuid',
          'record-uuid',
          { expectedVersion: 0, recordType: RecordType.OTHER },
          'user-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza registros inexistentes o no activos', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValueOnce(null);
      await expect(
        service.correct('patient-uuid', 'record-uuid', { expectedVersion: 0 }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);

      mockRepo.findByIdAndPatient.mockResolvedValueOnce(
        makeRecord({ status: RecordStatus.VOIDED }),
      );
      await expect(
        service.correct('patient-uuid', 'record-uuid', { expectedVersion: 0 }, 'user-uuid'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('void', () => {
    it('anula con CAS dentro de una única transacción', async () => {
      const original = makeRecord({ version: 5 });
      const voided = makeRecord({
        version: 6,
        status: RecordStatus.VOIDED,
        voidReason: 'Ingreso duplicado por error del sistema.',
      });
      mockRepo.findByIdAndPatient.mockResolvedValueOnce(original).mockResolvedValueOnce(voided);
      mockRepo.markVoided.mockResolvedValue(true);

      const result = await service.void(
        'patient-uuid',
        'record-uuid',
        { expectedVersion: 5, reason: 'Ingreso duplicado por error del sistema.' },
        'user-uuid',
      );

      expect(mockRepo.markVoided).toHaveBeenCalledWith(
        'record-uuid',
        'patient-uuid',
        5,
        'Ingreso duplicado por error del sistema.',
        'user-uuid',
        mockTx,
      );
      expect(result.version).toBe(6);
    });

    it('rechaza una versión obsoleta o un CAS perdido', async () => {
      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord({ version: 3 }));
      await expect(
        service.void(
          'patient-uuid',
          'record-uuid',
          { expectedVersion: 2, reason: 'Ingreso duplicado por error del sistema.' },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);

      mockRepo.findByIdAndPatient.mockResolvedValue(makeRecord({ version: 3 }));
      mockRepo.markVoided.mockResolvedValue(false);
      await expect(
        service.void(
          'patient-uuid',
          'record-uuid',
          { expectedVersion: 3, reason: 'Ingreso duplicado por error del sistema.' },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('secure drafts', () => {
    it('devuelve el borrador vigente del actor sin exponer actorId', async () => {
      mockRepo.findDraftByActorAndPatient.mockResolvedValue(makeDraft());
      const result = await service.getCurrentDraft('patient-uuid', 'user-uuid');
      expect(result).toEqual(expect.objectContaining({ id: 'draft-uuid', version: 0 }));
      expect(result).not.toHaveProperty('actorId');
    });

    it('elimina un borrador expirado y devuelve null', async () => {
      mockRepo.findDraftByActorAndPatient.mockResolvedValue(
        makeDraft({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(service.getCurrentDraft('patient-uuid', 'user-uuid')).resolves.toBeNull();
      expect(mockRepo.deleteDraftById).toHaveBeenCalledWith('draft-uuid', mockTx);
    });

    it('crea un borrador parcial con TTL y versión inicial cero', async () => {
      mockRepo.findDraftByActorAndPatient.mockResolvedValue(null);
      mockRepo.createDraft.mockImplementation(async (data: Record<string, unknown>) =>
        makeDraft({ ...data, version: 0 }),
      );

      const result = await service.upsertCurrentDraft(
        'patient-uuid',
        {
          payload: {
            recordType: RecordType.PRESCRIPTION,
            details: { medications: [{ name: 'Amoxicilina' }] },
          },
        },
        'user-uuid',
      );

      expect(mockRepo.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-uuid',
          actorId: 'user-uuid',
          payload: expect.objectContaining({ schemaVersion: 1 }),
        }),
        mockTx,
      );
      expect(result.version).toBe(0);
    });

    it('exige expectedVersion y actualiza el borrador con CAS', async () => {
      mockRepo.findDraftByActorAndPatient.mockResolvedValue(makeDraft({ version: 2 }));
      mockRepo.updateDraftCas.mockResolvedValue(makeDraft({ version: 3 }));

      const result = await service.upsertCurrentDraft(
        'patient-uuid',
        {
          expectedVersion: 2,
          payload: { recordType: RecordType.CONSULTATION, details: { chiefComplaint: 'Dolor' } },
        },
        'user-uuid',
      );
      expect(mockRepo.updateDraftCas).toHaveBeenCalledWith(
        'draft-uuid',
        'user-uuid',
        2,
        expect.anything(),
        expect.any(Date),
        mockTx,
      );
      expect(result.version).toBe(3);

      await expect(
        service.upsertCurrentDraft(
          'patient-uuid',
          { payload: { summary: 'Cambio sin versión.' } },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza campos details desconocidos incluso en un borrador parcial', async () => {
      await expect(
        service.upsertCurrentDraft(
          'patient-uuid',
          {
            payload: {
              recordType: RecordType.CONSULTATION,
              details: { campoInventado: 'no permitido' },
            },
          },
          'user-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('elimina el borrador con CAS y rechaza una carrera', async () => {
      mockRepo.findDraftByActorAndPatient.mockResolvedValue(makeDraft({ version: 4 }));
      mockRepo.deleteDraftCas.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(
        service.deleteCurrentDraft('patient-uuid', 4, 'user-uuid'),
      ).resolves.toBeUndefined();
      expect(mockRepo.deleteDraftCas).toHaveBeenCalledWith('draft-uuid', 'user-uuid', 4, mockTx);

      await expect(service.deleteCurrentDraft('patient-uuid', 3, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});

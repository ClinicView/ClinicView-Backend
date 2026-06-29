import { Test, TestingModule } from '@nestjs/testing';
import { RecordOrigin, RecordStatus, RecordType } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/rbac/permissions.guard';
import { ClinicalRecordsController } from '../clinical-records.controller';
import { ClinicalRecordsService } from '../clinical-records.service';

const makeResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 'record-uuid',
  patientId: 'patient-uuid',
  recordType: RecordType.CONSULTATION,
  origin: RecordOrigin.MANUAL,
  status: RecordStatus.ACTIVE,
  attendedAt: new Date('2026-06-01T10:00:00Z'),
  summary: 'Resumen de prueba.',
  notes: null,
  parentRecordId: null,
  voidReason: null,
  correctionsCount: 0,
  createdAt: new Date(),
  createdBy: 'user-uuid',
  updatedAt: new Date(),
  ...overrides,
});

const mockService = {
  create: jest.fn(),
  findByPatient: jest.fn(),
  findOne: jest.fn(),
  correct: jest.fn(),
  void: jest.fn(),
} satisfies Record<keyof ClinicalRecordsService, jest.Mock>;

describe('ClinicalRecordsController', () => {
  let controller: ClinicalRecordsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClinicalRecordsController],
      providers: [{ provide: ClinicalRecordsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ClinicalRecordsController);
    jest.clearAllMocks();
  });

  const req = { user: { sub: 'user-uuid' } };

  describe('create', () => {
    it('crea y devuelve el registro', async () => {
      const response = makeResponse();
      mockService.create.mockResolvedValue(response);

      const result = await controller.create(
        'patient-uuid',
        { recordType: RecordType.CONSULTATION, attendedAt: '2026-06-01T10:00:00Z', summary: 'Resumen.' },
        req,
      );

      expect(mockService.create).toHaveBeenCalledWith(
        'patient-uuid',
        expect.objectContaining({ summary: 'Resumen.' }),
        'user-uuid',
      );
      expect(result).toBe(response);
    });
  });

  describe('findAll', () => {
    it('delega en el servicio y retorna la respuesta paginada', async () => {
      const paginated = { data: [makeResponse()], total: 1, page: 1, limit: 20 };
      mockService.findByPatient.mockResolvedValue(paginated);

      const result = await controller.findAll('patient-uuid', {});
      expect(mockService.findByPatient).toHaveBeenCalledWith('patient-uuid', {});
      expect(result).toBe(paginated);
    });
  });

  describe('findOne', () => {
    it('devuelve el registro solicitado', async () => {
      const response = makeResponse();
      mockService.findOne.mockResolvedValue(response);

      const result = await controller.findOne('patient-uuid', 'record-uuid');
      expect(mockService.findOne).toHaveBeenCalledWith('patient-uuid', 'record-uuid');
      expect(result).toBe(response);
    });
  });

  describe('correct', () => {
    it('llama al servicio con los parámetros correctos', async () => {
      const response = makeResponse({ id: 'new-uuid', parentRecordId: 'record-uuid' });
      mockService.correct.mockResolvedValue(response);

      const result = await controller.correct(
        'patient-uuid',
        'record-uuid',
        { summary: 'Corrección.' },
        req,
      );

      expect(mockService.correct).toHaveBeenCalledWith(
        'patient-uuid',
        'record-uuid',
        { summary: 'Corrección.' },
        'user-uuid',
      );
      expect(result).toBe(response);
    });
  });

  describe('void', () => {
    it('llama al servicio con la razón de anulación', async () => {
      const response = makeResponse({ status: RecordStatus.VOIDED, voidReason: 'Duplicado por error del sistema.' });
      mockService.void.mockResolvedValue(response);

      const result = await controller.void(
        'patient-uuid',
        'record-uuid',
        { reason: 'Duplicado por error del sistema.' },
        req,
      );

      expect(mockService.void).toHaveBeenCalledWith(
        'patient-uuid',
        'record-uuid',
        { reason: 'Duplicado por error del sistema.' },
        'user-uuid',
      );
      expect(result.status).toBe(RecordStatus.VOIDED);
    });
  });
});

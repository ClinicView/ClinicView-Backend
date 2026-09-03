import { Test, TestingModule } from '@nestjs/testing';
import { DocumentType, Sex } from '@prisma/client';
import { PERMISSIONS_KEY } from '../../../core/rbac/requires-permissions.decorator';
import { PatientResponseDto } from '../dto/patient-response.dto';
import { PatientsController } from '../patients.controller';
import { PatientsService } from '../patients.service';

const mockPatient: PatientResponseDto = {
  id: 'patient-uuid-001',
  documentType: DocumentType.DNI,
  documentNumber: '12345678',
  firstName: 'María',
  lastName: 'García López',
  dateOfBirth: '1985-06-15',
  sex: Sex.F,
  phone: null,
  email: null,
  address: null,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockPatientsService = {
  create: jest.fn().mockResolvedValue(mockPatient),
  findAll: jest.fn().mockResolvedValue({ data: [mockPatient], total: 1, page: 1, limit: 20 }),
  findOne: jest.fn().mockResolvedValue(mockPatient),
  update: jest.fn().mockResolvedValue(mockPatient),
  deactivate: jest.fn().mockResolvedValue({ ...mockPatient, isActive: false }),
  getCurrentRegistrationDraft: jest.fn().mockResolvedValue(null),
  upsertCurrentRegistrationDraft: jest.fn().mockResolvedValue({
    id: '93d89f74-3d39-4ed8-b050-8efab881d16b',
    payload: { firstName: 'María' },
    version: 0,
    expiresAt: new Date('2099-09-10T12:00:00.000Z'),
    createdAt: new Date('2026-09-03T12:00:00.000Z'),
    updatedAt: new Date('2026-09-03T12:00:00.000Z'),
  }),
  deleteCurrentRegistrationDraft: jest.fn().mockResolvedValue(undefined),
  exportClinicalHistory: jest.fn().mockResolvedValue({
    patient: mockPatient,
    records: [],
    documents: [],
    generatedAt: new Date('2026-09-02T12:00:00.000Z'),
  }),
};

describe('PatientsController', () => {
  let controller: PatientsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatientsController],
      providers: [{ provide: PatientsService, useValue: mockPatientsService }],
    }).compile();

    controller = module.get(PatientsController);
  });

  it('create delega en PatientsService', async () => {
    const dto = {
      documentType: DocumentType.DNI,
      documentNumber: '12345678',
      firstName: 'María',
      lastName: 'García López',
      dateOfBirth: '1985-06-15',
      sex: Sex.F,
    };
    const request = { user: { sub: 'actor-uuid' } };
    const result = await controller.create(dto, request);
    expect(mockPatientsService.create).toHaveBeenCalledWith(dto, 'actor-uuid');
    expect(result.id).toBe(mockPatient.id);
  });

  it('expone el borrador propio y responde 204 cuando no existe', async () => {
    const response = { status: jest.fn() };
    const result = await controller.getCurrentRegistrationDraft(
      { user: { sub: 'actor-uuid' } },
      response as never,
    );

    expect(result).toBeNull();
    expect(response.status).toHaveBeenCalledWith(204);
    expect(mockPatientsService.getCurrentRegistrationDraft).toHaveBeenCalledWith('actor-uuid');
  });

  it('delega guardado y eliminación CAS del borrador', async () => {
    const request = { user: { sub: 'actor-uuid' } };
    const dto = { payload: { firstName: 'María' } };
    await controller.upsertCurrentRegistrationDraft(dto, request);
    await controller.deleteCurrentRegistrationDraft(
      { draftId: '93d89f74-3d39-4ed8-b050-8efab881d16b', expectedVersion: 0 },
      request,
    );

    expect(mockPatientsService.upsertCurrentRegistrationDraft).toHaveBeenCalledWith(
      dto,
      'actor-uuid',
    );
    expect(mockPatientsService.deleteCurrentRegistrationDraft).toHaveBeenCalledWith(
      '93d89f74-3d39-4ed8-b050-8efab881d16b',
      0,
      'actor-uuid',
    );
  });

  it('protege las tres rutas del borrador con patients.create', () => {
    for (const method of [
      PatientsController.prototype.getCurrentRegistrationDraft,
      PatientsController.prototype.upsertCurrentRegistrationDraft,
      PatientsController.prototype.deleteCurrentRegistrationDraft,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['patients.create']);
    }
  });

  it('findAll devuelve paginación', async () => {
    const result = await controller.findAll({ page: 1, limit: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('findOne devuelve el paciente correcto', async () => {
    const result = await controller.findOne(mockPatient.id);
    expect(result.id).toBe(mockPatient.id);
  });

  it('exportClinicalHistory delega la exportación completa en PatientsService', async () => {
    const request = { user: { sub: 'actor-uuid' } };
    const result = await controller.exportClinicalHistory(mockPatient.id, request);

    expect(mockPatientsService.exportClinicalHistory).toHaveBeenCalledWith(
      mockPatient.id,
      'actor-uuid',
    );
    expect(result.records).toEqual([]);
    expect(result.documents).toEqual([]);
  });

  it('protege la exportación con permisos de pacientes, registros y documentos', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PatientsController.prototype.exportClinicalHistory,
    );

    expect(permissions).toEqual(['patients.read', 'records.read', 'documents.read']);
  });

  it('deactivate devuelve paciente con isActive=false', async () => {
    const result = await controller.deactivate(mockPatient.id);
    expect(result.isActive).toBe(false);
  });
});

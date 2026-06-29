import { Test, TestingModule } from '@nestjs/testing';
import { DocumentType, Sex } from '@prisma/client';
import { PatientResponseDto } from '../dto/patient-response.dto';
import { PatientsController } from '../patients.controller';
import { PatientsService } from '../patients.service';

const mockPatient: PatientResponseDto = {
  id: 'patient-uuid-001',
  documentType: DocumentType.DNI,
  documentNumber: '12345678',
  firstName: 'María',
  lastName: 'García López',
  dateOfBirth: new Date('1985-06-15'),
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
    const result = await controller.create(dto);
    expect(mockPatientsService.create).toHaveBeenCalledWith(dto);
    expect(result.id).toBe(mockPatient.id);
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

  it('deactivate devuelve paciente con isActive=false', async () => {
    const result = await controller.deactivate(mockPatient.id);
    expect(result.isActive).toBe(false);
  });
});

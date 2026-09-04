import { Readable } from 'node:stream';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentStatus } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/rbac/permissions.guard';
import { MedicalDocumentsController } from '../medical-documents.controller';
import { MedicalDocumentsService } from '../medical-documents.service';

const makeResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-uuid',
  patientId: 'patient-uuid',
  originalName: 'informe.pdf',
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
  createdAt: new Date(),
  createdBy: 'user-uuid',
  processedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  validationChecklist: null,
  validationAttested: false,
  validationAttestedAt: null,
  updatedAt: new Date(),
  version: 0,
  ...overrides,
});

const mockService = {
  upload: jest.fn(),
  findByPatient: jest.fn(),
  findOne: jest.fn(),
  getFile: jest.fn(),
  process: jest.fn(),
  validate: jest.fn(),
  saveCorrection: jest.fn(),
  reject: jest.fn(),
  searchByKeyword: jest.fn(),
  onModuleInit: jest.fn(),
} satisfies Record<keyof MedicalDocumentsService, jest.Mock>;

const req = { user: { sub: 'user-uuid' } };

describe('MedicalDocumentsController', () => {
  let controller: MedicalDocumentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicalDocumentsController],
      providers: [{ provide: MedicalDocumentsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MedicalDocumentsController);
    jest.clearAllMocks();
  });

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'informe.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('PDF'),
    size: 3,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
  };

  it('upload delega en el servicio', async () => {
    const response = makeResponse();
    mockService.upload.mockResolvedValue(response);
    const result = await controller.upload('patient-uuid', mockFile, req);
    expect(mockService.upload).toHaveBeenCalledWith('patient-uuid', mockFile, 'user-uuid');
    expect(result.id).toBe('doc-uuid');
  });

  it('findAll delega en el servicio', async () => {
    const paginated = { data: [makeResponse()], total: 1, page: 1, limit: 20 };
    mockService.findByPatient.mockResolvedValue(paginated);
    const result = await controller.findAll('patient-uuid', {});
    expect(mockService.findByPatient).toHaveBeenCalledWith('patient-uuid', {});
    expect(result).toBe(paginated);
  });

  it('findOne delega en el servicio', async () => {
    const response = makeResponse();
    mockService.findOne.mockResolvedValue(response);
    const result = await controller.findOne('patient-uuid', 'doc-uuid');
    expect(mockService.findOne).toHaveBeenCalledWith('patient-uuid', 'doc-uuid');
    expect(result).toBe(response);
  });

  it('protege la descarga clínica contra cache y sniffing', async () => {
    const stream = Readable.from(Buffer.from('%PDF-1.4\n%%EOF'));
    mockService.getFile.mockResolvedValue({
      document: makeResponse({ originalName: 'informe clínico.pdf' }),
      stream,
    });
    const response = { set: jest.fn() } as unknown as Response;

    await controller.downloadFile('patient-uuid', 'doc-uuid', response);

    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
        'X-Content-Type-Options': 'nosniff',
      }),
    );
  });

  it('process delega en el servicio', async () => {
    const response = makeResponse({ status: DocumentStatus.PROCESSED });
    mockService.process.mockResolvedValue(response);
    const result = await controller.process('patient-uuid', 'doc-uuid', req);
    expect(mockService.process).toHaveBeenCalledWith('patient-uuid', 'doc-uuid', 'user-uuid');
    expect(result.status).toBe(DocumentStatus.PROCESSED);
  });

  it('validate delega en el servicio', async () => {
    const dto = {
      expectedVersion: 0,
      correctedText: 'texto final',
      correctedEntities: [],
      checklistItems: ['text', 'entities', 'sections', 'phi'],
      attested: true as const,
    };
    const response = makeResponse({ status: DocumentStatus.VALIDATED });
    mockService.validate.mockResolvedValue(response);
    const result = await controller.validate('patient-uuid', 'doc-uuid', dto, req);
    expect(mockService.validate).toHaveBeenCalledWith(
      'patient-uuid',
      'doc-uuid',
      dto,
      'user-uuid',
    );
    expect(result.status).toBe(DocumentStatus.VALIDATED);
  });

  it('saveCorrection delega en el servicio', async () => {
    const dto = { expectedVersion: 0, correctedText: 'texto corregido', correctedEntities: [] };
    const response = makeResponse({ status: DocumentStatus.PROCESSED, correctedText: 'texto corregido' });
    mockService.saveCorrection.mockResolvedValue(response);

    const result = await controller.saveCorrection('patient-uuid', 'doc-uuid', dto, req);

    expect(mockService.saveCorrection).toHaveBeenCalledWith(
      'patient-uuid',
      'doc-uuid',
      dto,
      'user-uuid',
    );
    expect(result.correctedText).toBe('texto corregido');
  });

  it('reject delega en el servicio con el motivo', async () => {
    const response = makeResponse({ status: DocumentStatus.REJECTED, rejectReason: 'Documento ilegible por mala calidad.' });
    mockService.reject.mockResolvedValue(response);
    const result = await controller.reject(
      'patient-uuid',
      'doc-uuid',
      { expectedVersion: 0, reason: 'Documento ilegible por mala calidad.' },
      req,
    );
    expect(mockService.reject).toHaveBeenCalledWith(
      'patient-uuid',
      'doc-uuid',
      { expectedVersion: 0, reason: 'Documento ilegible por mala calidad.' },
      'user-uuid',
    );
    expect(result.status).toBe(DocumentStatus.REJECTED);
  });
});

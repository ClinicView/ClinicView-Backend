import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentType, Patient, PatientRegistrationDraft, Sex } from '@prisma/client';
import { CreatePatientDto } from '../dto/create-patient.dto';
import { UpdatePatientDto } from '../dto/update-patient.dto';
import { PatientsRepository } from '../repositories/patients.repository';
import { PatientsService } from '../patients.service';

const mockPatient: Patient = {
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
  createdBy: null,
  updatedAt: new Date('2026-01-01'),
  updatedBy: null,
  version: 0,
};

const mockDraft: PatientRegistrationDraft = {
  id: '93d89f74-3d39-4ed8-b050-8efab881d16b',
  actorId: 'actor-uuid',
  payload: { firstName: 'María' },
  version: 2,
  expiresAt: new Date('2099-09-10T12:00:00.000Z'),
  createdAt: new Date('2026-09-03T12:00:00.000Z'),
  updatedAt: new Date('2026-09-03T12:05:00.000Z'),
};

describe('PatientsService', () => {
  let service: PatientsService;
  let repo: jest.Mocked<PatientsRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        {
          provide: PatientsRepository,
          useValue: {
            create: jest.fn(),
            findMany: jest.fn(),
            findById: jest.fn(),
            findClinicalHistoryForExport: jest.fn(),
            findByDocument: jest.fn(),
            update: jest.fn(),
            deactivate: jest.fn(),
            activate: jest.fn(),
            findRegistrationDraftByActor: jest.fn(),
            upsertRegistrationDraft: jest.fn(),
            deleteRegistrationDraft: jest.fn(),
            purgeExpiredRegistrationDrafts: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(7) },
        },
      ],
    }).compile();

    service = module.get(PatientsService);
    repo = module.get(PatientsRepository);
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreatePatientDto = {
      documentType: DocumentType.DNI,
      documentNumber: '12345678',
      firstName: 'María',
      lastName: 'García López',
      dateOfBirth: '1985-06-15',
      sex: Sex.F,
    };

    it('crea el paciente cuando el documento no existe', async () => {
      repo.create.mockResolvedValue(mockPatient);

      const result = await service.create(dto, 'actor-uuid');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'actor-uuid' }),
        undefined,
      );
      expect(result.id).toBe(mockPatient.id);
      expect(result.dateOfBirth).toBe('1985-06-15');
    });

    it('consume el borrador por identidad y versión en la misma creación', async () => {
      repo.create.mockResolvedValue(mockPatient);
      await service.create(
        { ...dto, draftId: mockDraft.id, expectedDraftVersion: mockDraft.version },
        'actor-uuid',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'actor-uuid' }),
        { id: mockDraft.id, version: mockDraft.version, actorId: 'actor-uuid' },
      );
    });

    it('rechaza referencias incompletas al borrador', async () => {
      await expect(service.create({ ...dto, draftId: mockDraft.id }, 'actor-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('convierte una carrera P2002 en conflicto genérico sin PII', async () => {
      repo.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.create(dto, 'actor-uuid')).rejects.toThrow(
        'Ya existe un paciente con ese tipo y número de documento.',
      );
    });

    it('rechaza el alta si el borrador no se pudo consumir', async () => {
      repo.create.mockResolvedValue(null);
      await expect(
        service.create(
          { ...dto, draftId: mockDraft.id, expectedDraftVersion: mockDraft.version },
          'actor-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('exige actor autenticado', async () => {
      await expect(service.create(dto, '')).rejects.toThrow(UnauthorizedException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('registration draft', () => {
    it('devuelve solo el borrador vigente del actor sin exponer actorId', async () => {
      repo.purgeExpiredRegistrationDrafts.mockResolvedValue(0);
      repo.findRegistrationDraftByActor.mockResolvedValue(mockDraft);

      const result = await service.getCurrentRegistrationDraft('actor-uuid');

      expect(repo.findRegistrationDraftByActor).toHaveBeenCalledWith('actor-uuid');
      expect(result).toEqual(
        expect.objectContaining({ id: mockDraft.id, version: mockDraft.version }),
      );
      expect(result).not.toHaveProperty('actorId');
    });

    it('crea un borrador y renueva su TTL a siete días', async () => {
      repo.upsertRegistrationDraft.mockResolvedValue(mockDraft);
      const before = Date.now();

      const result = await service.upsertCurrentRegistrationDraft(
        { payload: { firstName: 'María' } },
        'actor-uuid',
      );

      expect(result.id).toBe(mockDraft.id);
      expect(repo.upsertRegistrationDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-uuid',
          expectedId: undefined,
          expectedVersion: undefined,
          payload: { firstName: 'María' },
          expiresAt: expect.any(Date),
        }),
      );
      const input = repo.upsertRegistrationDraft.mock.calls[0][0];
      expect(input.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 86400000);
    });

    it('exige ID y versión juntos también al actualizar', async () => {
      await expect(
        service.upsertCurrentRegistrationDraft(
          { expectedId: mockDraft.id, payload: {} },
          'actor-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('informa conflicto de versión o ABA sin sobrescribir', async () => {
      repo.upsertRegistrationDraft.mockResolvedValue(null);
      await expect(
        service.upsertCurrentRegistrationDraft(
          {
            expectedId: mockDraft.id,
            expectedVersion: mockDraft.version,
            payload: { lastName: 'García' },
          },
          'actor-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('elimina mediante CAS y rechaza una identidad que cambió', async () => {
      repo.deleteRegistrationDraft.mockResolvedValue(false);
      await expect(
        service.deleteCurrentRegistrationDraft(mockDraft.id, 1, 'actor-uuid'),
      ).rejects.toThrow(ConflictException);
      expect(repo.deleteRegistrationDraft).toHaveBeenCalledWith({
        id: mockDraft.id,
        version: 1,
        actorId: 'actor-uuid',
      });
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('devuelve paginación con datos, total, page y limit', async () => {
      repo.findMany.mockResolvedValue({ data: [mockPatient], total: 1 });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('devuelve el paciente si existe', async () => {
      repo.findById.mockResolvedValue(mockPatient);
      const result = await service.findOne(mockPatient.id);
      expect(result.id).toBe(mockPatient.id);
    });

    it('lanza NotFoundException si no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findOne('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('exportClinicalHistory', () => {
    const recordCreatedAt = new Date('2025-05-10T15:00:00.000Z');
    const documentCreatedAt = new Date('2025-05-11T15:00:00.000Z');
    const firstAttachmentCreatedAt = new Date('2025-05-10T15:02:00.000Z');
    const secondAttachmentCreatedAt = new Date('2025-05-10T15:03:00.000Z');

    const snapshot = {
      id: mockPatient.id,
      documentType: mockPatient.documentType,
      documentNumber: mockPatient.documentNumber,
      firstName: mockPatient.firstName,
      lastName: mockPatient.lastName,
      dateOfBirth: mockPatient.dateOfBirth,
      sex: mockPatient.sex,
      phone: mockPatient.phone,
      email: mockPatient.email,
      address: mockPatient.address,
      clinicalRecords: [
        {
          id: 'record-1',
          recordType: 'CONSULTATION' as const,
          origin: 'MANUAL' as const,
          status: 'VOIDED' as const,
          attendedAt: recordCreatedAt,
          summary: 'Consulta original',
          notes: 'Nota clínica',
          details: { chiefComplaint: 'Dolor torácico' },
          schemaVersion: 1,
          doctorName: 'Dra. Rivera',
          professionalId: 'professional-uuid',
          professionalNameSnapshot: 'Dra. Elena Rivera',
          professionalLicenseSnapshot: 'CMP 12345',
          service: 'Medicina interna',
          preliminaryDiagnosis: 'Diagnóstico preliminar',
          plan: 'Plan clínico',
          priority: 'PRIORITY',
          parentRecordId: null,
          voidReason: 'Duplicado',
          createdAt: recordCreatedAt,
          createdBy: 'creator-uuid',
          updatedAt: recordCreatedAt,
          updatedBy: 'updater-uuid',
          version: 4,
          attachments: [
            {
              id: 'attachment-b',
              assetId: 'asset-b',
              sectionKey: 'physicalExam',
              caption: 'Vista lateral',
              altText: 'Lesión observada desde el lado derecho',
              sortOrder: 1,
              createdBy: 'creator-uuid',
              createdAt: secondAttachmentCreatedAt,
              asset: {
                id: 'asset-b',
                patientId: mockPatient.id,
                originalName: 'vista-lateral.png',
                mimeType: 'image/png',
                sizeBytes: 4096,
                width: 1200,
                height: 900,
                sha256: 'b'.repeat(64),
                status: 'ATTACHED' as const,
                expiresAt: null,
                version: 1,
                createdAt: secondAttachmentCreatedAt,
                updatedAt: secondAttachmentCreatedAt,
                storagePath: 'clinical-media/private/asset-b.png',
                uploadedBy: 'uploader-uuid',
              },
            },
            {
              id: 'attachment-a',
              assetId: 'asset-a',
              sectionKey: null,
              caption: 'Vista frontal',
              altText: 'Lesión observada de frente',
              sortOrder: 0,
              createdBy: 'creator-uuid',
              createdAt: firstAttachmentCreatedAt,
              asset: {
                id: 'asset-a',
                patientId: mockPatient.id,
                originalName: 'vista-frontal.jpg',
                mimeType: 'image/jpeg',
                sizeBytes: 3072,
                width: 1200,
                height: 900,
                sha256: 'a'.repeat(64),
                status: 'ATTACHED' as const,
                expiresAt: null,
                version: 1,
                createdAt: firstAttachmentCreatedAt,
                updatedAt: firstAttachmentCreatedAt,
                storagePath: 'clinical-media/private/asset-a.jpg',
                uploadedBy: 'uploader-uuid',
              },
            },
          ],
        },
      ],
      medicalDocuments: [
        {
          id: 'document-validated',
          originalName: 'validado.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          status: 'VALIDATED' as const,
          ocrText: 'OCR original',
          correctedText: 'Texto clínico corregido',
          rejectReason: null,
          createdAt: documentCreatedAt,
          processedAt: documentCreatedAt,
          correctedAt: documentCreatedAt,
          correctedById: 'corrector-uuid',
          reviewedAt: documentCreatedAt,
          reviewedBy: 'reviewer-uuid',
          validationChecklist: { schemaVersion: 1, locale: 'es-PE', items: [] },
          validationAttestedAt: documentCreatedAt,
          createdBy: 'creator-uuid',
          updatedBy: 'reviewer-uuid',
        },
        {
          id: 'document-pending-review',
          originalName: 'sin-validar.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          status: 'PROCESSED' as const,
          ocrText: 'Texto OCR aún no validado',
          correctedText: null,
          rejectReason: null,
          createdAt: documentCreatedAt,
          processedAt: documentCreatedAt,
          correctedAt: null,
          correctedById: null,
          reviewedAt: null,
          reviewedBy: null,
          validationChecklist: null,
          validationAttestedAt: null,
          createdBy: 'creator-uuid',
          updatedBy: null,
        },
      ],
    };

    it('incluye todos los estados y solo expone texto de documentos validados', async () => {
      repo.findClinicalHistoryForExport.mockResolvedValue(snapshot);

      const result = await service.exportClinicalHistory(mockPatient.id, 'actor-uuid');

      expect(repo.findClinicalHistoryForExport).toHaveBeenCalledWith(mockPatient.id);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].status).toBe('VOIDED');
      expect(result.records[0]).toEqual(
        expect.objectContaining({
          details: { chiefComplaint: 'Dolor torácico' },
          schemaVersion: 1,
          version: 4,
          professionalId: 'professional-uuid',
          professionalNameSnapshot: 'Dra. Elena Rivera',
          professionalLicenseSnapshot: 'CMP 12345',
        }),
      );
      expect(result.records[0].attachments.map((attachment) => attachment.id)).toEqual([
        'attachment-a',
        'attachment-b',
      ]);
      expect(result.records[0].attachments[0].asset).toEqual(
        expect.objectContaining({
          id: 'asset-a',
          contentUrl: `/patients/${mockPatient.id}/record-media/asset-a/content`,
        }),
      );
      expect(result.records[0].attachments[0].asset).not.toHaveProperty('storagePath');
      expect(result.records[0].attachments[0].asset).not.toHaveProperty('uploadedBy');
      expect(result.patient.dateOfBirth).toBe('1985-06-15');
      expect(result.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'document-validated',
            clinicalText: 'Texto clínico corregido',
            textSource: 'CORRECTED',
          }),
          expect.objectContaining({
            id: 'document-pending-review',
            status: 'PROCESSED',
            clinicalText: null,
            textSource: 'NONE',
          }),
        ]),
      );
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('usa OCR si una corrección histórica validada solo contiene espacios', async () => {
      repo.findClinicalHistoryForExport.mockResolvedValue({
        ...snapshot,
        medicalDocuments: [
          {
            ...snapshot.medicalDocuments[0],
            correctedText: '   ',
          },
        ],
      });

      const result = await service.exportClinicalHistory(mockPatient.id, 'actor-uuid');

      expect(result.documents[0]).toEqual(
        expect.objectContaining({ clinicalText: 'OCR original', textSource: 'OCR' }),
      );
    });

    it('exige actor autenticado antes de leer datos clínicos', async () => {
      await expect(service.exportClinicalHistory(mockPatient.id, '')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repo.findClinicalHistoryForExport).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el paciente no existe', async () => {
      repo.findClinicalHistoryForExport.mockResolvedValue(null);

      await expect(service.exportClinicalHistory('inexistente', 'actor-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('actualiza campos permitidos (no documentType ni documentNumber)', async () => {
      const dto: UpdatePatientDto = { firstName: 'Ana' };
      repo.findById.mockResolvedValue(mockPatient);
      repo.update.mockResolvedValue({ ...mockPatient, firstName: 'Ana' });

      const result = await service.update(mockPatient.id, dto);

      expect(result.firstName).toBe('Ana');
    });

    it('lanza NotFoundException si el paciente no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update('inexistente', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── deactivate ───────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('desactiva el paciente (soft delete)', async () => {
      repo.findById.mockResolvedValue(mockPatient);
      repo.deactivate.mockResolvedValue({ ...mockPatient, isActive: false });

      const result = await service.deactivate(mockPatient.id);
      expect(result.isActive).toBe(false);
    });

    it('lanza NotFoundException si no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deactivate('inexistente')).rejects.toThrow(NotFoundException);
    });
  });
});

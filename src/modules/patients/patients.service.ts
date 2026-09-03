import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Patient, PatientRegistrationDraft, Prisma } from '@prisma/client';
import {
  databaseDateToDateOnly,
  dateOnlyToDatabaseDate,
} from '../../common/validation/clinical-date';
import { buildClinicalMediaContentUrl } from '../clinical-records/dto/record-attachment.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { ClinicalHistoryExportResponseDto } from './dto/clinical-history-export-response.dto';
import { FindPatientsQueryDto } from './dto/find-patients-query.dto';
import { PatientResponseDto } from './dto/patient-response.dto';
import {
  PatientRegistrationDraftPayloadDto,
  PatientRegistrationDraftResponseDto,
  UpsertPatientRegistrationDraftDto,
} from './dto/patient-registration-draft.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientsRepository } from './repositories/patients.repository';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code,
  );
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    private readonly patientsRepository: PatientsRepository,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreatePatientDto, actorId: string): Promise<PatientResponseDto> {
    this.requireActor(actorId);
    this.assertDraftIdentityPair(dto.draftId, dto.expectedDraftVersion);

    try {
      const patient = await this.patientsRepository.create(
        {
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth: dateOnlyToDatabaseDate(dto.dateOfBirth),
          sex: dto.sex,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
          createdBy: actorId,
        },
        dto.draftId !== undefined && dto.expectedDraftVersion !== undefined
          ? { id: dto.draftId, version: dto.expectedDraftVersion, actorId }
          : undefined,
      );
      if (!patient) {
        throw new ConflictException(
          'El borrador cambió o expiró. Recarga el formulario antes de registrar al paciente.',
        );
      }
      return this.toResponse(patient);
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Ya existe un paciente con ese tipo y número de documento.');
      }
      if (isPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException(
          'El registro cambió durante la operación. Inténtalo nuevamente.',
        );
      }
      throw error;
    }
  }

  async getCurrentRegistrationDraft(
    actorId: string,
  ): Promise<PatientRegistrationDraftResponseDto | null> {
    this.requireActor(actorId);
    await this.patientsRepository.purgeExpiredRegistrationDrafts();
    const draft = await this.patientsRepository.findRegistrationDraftByActor(actorId);
    if (!draft || draft.expiresAt.getTime() <= Date.now()) return null;
    return this.toDraftResponse(draft);
  }

  async upsertCurrentRegistrationDraft(
    dto: UpsertPatientRegistrationDraftDto,
    actorId: string,
  ): Promise<PatientRegistrationDraftResponseDto> {
    this.requireActor(actorId);
    this.assertDraftIdentityPair(dto.expectedId, dto.expectedVersion);
    const ttlDays = this.configService.get<number>('patientDraft.ttlDays', 7);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    try {
      const draft = await this.patientsRepository.upsertRegistrationDraft({
        actorId,
        expectedId: dto.expectedId,
        expectedVersion: dto.expectedVersion,
        payload: this.normalizeDraftPayload(dto.payload),
        expiresAt,
      });
      if (!draft) {
        throw new ConflictException(
          'El borrador fue modificado o reemplazado en otra pestaña. Recarga antes de continuar.',
        );
      }
      return this.toDraftResponse(draft);
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002') || isPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException(
          'El borrador cambió durante la operación. Recarga antes de continuar.',
        );
      }
      throw error;
    }
  }

  async deleteCurrentRegistrationDraft(
    draftId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    this.requireActor(actorId);
    const deleted = await this.patientsRepository.deleteRegistrationDraft({
      id: draftId,
      version: expectedVersion,
      actorId,
    });
    if (!deleted) {
      throw new ConflictException(
        'El borrador fue modificado o reemplazado en otra pestaña. Recarga antes de eliminarlo.',
      );
    }
  }

  async stats(): Promise<{
    total: number;
    active: number;
    newThisMonth: number;
    withPendingDocs: number;
    withRecentDocs: number;
  }> {
    return this.patientsRepository.stats();
  }

  async findAll(query: FindPatientsQueryDto): Promise<PaginatedResponse<PatientResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const { data, total } = await this.patientsRepository.findMany({
      search: query.search,
      documentType: query.documentType,
      documentNumber: query.documentNumber,
      skip,
      take: limit,
    });

    return { data: data.map((p) => this.toResponse(p)), total, page, limit };
  }

  async findOne(id: string): Promise<PatientResponseDto> {
    const patient = await this.patientsRepository.findById(id);
    if (!patient) throw new NotFoundException('Paciente no encontrado.');
    return this.toResponse(patient);
  }

  async exportClinicalHistory(
    id: string,
    actorId: string,
  ): Promise<ClinicalHistoryExportResponseDto> {
    if (!actorId) throw new UnauthorizedException('No se pudo identificar al usuario autenticado.');
    const snapshot = await this.patientsRepository.findClinicalHistoryForExport(id);
    if (!snapshot) throw new NotFoundException('Paciente no encontrado.');

    const { clinicalRecords, medicalDocuments, ...patient } = snapshot;

    const result: ClinicalHistoryExportResponseDto = {
      patient: {
        ...patient,
        dateOfBirth: databaseDateToDateOnly(patient.dateOfBirth),
      },
      records: clinicalRecords.map((record) => ({
        id: record.id,
        recordType: record.recordType,
        origin: record.origin,
        status: record.status,
        attendedAt: record.attendedAt,
        summary: record.summary,
        notes: record.notes,
        details: record.details as Record<string, unknown>,
        schemaVersion: record.schemaVersion,
        doctorName: record.doctorName,
        professionalId: record.professionalId,
        professionalNameSnapshot: record.professionalNameSnapshot,
        professionalLicenseSnapshot: record.professionalLicenseSnapshot,
        service: record.service,
        preliminaryDiagnosis: record.preliminaryDiagnosis,
        plan: record.plan,
        priority: record.priority,
        parentRecordId: record.parentRecordId,
        voidReason: record.voidReason,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        version: record.version,
        attachments: [...record.attachments]
          .sort(
            (left, right) =>
              left.sortOrder - right.sortOrder ||
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          )
          .map((attachment) => ({
            id: attachment.id,
            assetId: attachment.assetId,
            sectionKey: attachment.sectionKey,
            caption: attachment.caption,
            altText: attachment.altText,
            sortOrder: attachment.sortOrder,
            createdBy: attachment.createdBy,
            createdAt: attachment.createdAt,
            asset: {
              id: attachment.asset.id,
              patientId: attachment.asset.patientId,
              originalName: attachment.asset.originalName,
              mimeType: attachment.asset.mimeType,
              sizeBytes: attachment.asset.sizeBytes,
              width: attachment.asset.width,
              height: attachment.asset.height,
              sha256: attachment.asset.sha256,
              status: attachment.asset.status,
              expiresAt: attachment.asset.expiresAt,
              version: attachment.asset.version,
              createdAt: attachment.asset.createdAt,
              updatedAt: attachment.asset.updatedAt,
              contentUrl: buildClinicalMediaContentUrl(
                attachment.asset.patientId,
                attachment.asset.id,
              ),
            },
          })),
      })),
      documents: medicalDocuments.map((document) => {
        const canExposeClinicalText = document.status === 'VALIDATED';
        const correctedText = document.correctedText?.trim();
        const ocrText = document.ocrText?.trim();
        const clinicalText = canExposeClinicalText ? correctedText || ocrText || null : null;

        return {
          id: document.id,
          originalName: document.originalName,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          status: document.status,
          clinicalText,
          textSource: clinicalText === null ? 'NONE' : correctedText ? 'CORRECTED' : 'OCR',
          rejectReason: document.rejectReason,
          createdAt: document.createdAt,
          processedAt: document.processedAt,
          correctedAt: document.correctedAt,
          correctedById: document.correctedById,
          reviewedAt: document.reviewedAt,
          reviewedBy: document.reviewedBy,
          validationChecklist: document.validationChecklist,
          validationAttestedAt: document.validationAttestedAt,
          createdBy: document.createdBy,
          updatedBy: document.updatedBy,
        };
      }),
      generatedAt: new Date(),
    };

    this.logger.log(
      JSON.stringify({
        event: 'clinical_history_exported',
        actorId,
        patientId: id,
        recordCount: result.records.length,
        documentCount: result.documents.length,
        generatedAt: result.generatedAt.toISOString(),
      }),
    );

    return result;
  }

  async update(id: string, dto: UpdatePatientDto): Promise<PatientResponseDto> {
    const existing = await this.patientsRepository.findById(id);
    if (!existing) throw new NotFoundException('Paciente no encontrado.');

    const data: Parameters<typeof this.patientsRepository.update>[1] = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dateOnlyToDatabaseDate(dto.dateOfBirth);
    }
    if (dto.sex !== undefined) data.sex = dto.sex;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.address !== undefined) data.address = dto.address;

    const patient = await this.patientsRepository.update(id, data);
    return this.toResponse(patient);
  }

  async deactivate(id: string): Promise<PatientResponseDto> {
    const existing = await this.patientsRepository.findById(id);
    if (!existing) throw new NotFoundException('Paciente no encontrado.');
    const patient = await this.patientsRepository.deactivate(id);
    return this.toResponse(patient);
  }

  async activate(id: string): Promise<PatientResponseDto> {
    const existing = await this.patientsRepository.findById(id);
    if (!existing) throw new NotFoundException('Paciente no encontrado.');
    const patient = await this.patientsRepository.activate(id);
    return this.toResponse(patient);
  }

  private toResponse(patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      documentType: patient.documentType,
      documentNumber: patient.documentNumber,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: databaseDateToDateOnly(patient.dateOfBirth),
      sex: patient.sex,
      phone: patient.phone,
      email: patient.email,
      address: patient.address,
      isActive: patient.isActive,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }

  private requireActor(actorId: string): void {
    if (!actorId?.trim()) {
      throw new UnauthorizedException('No se pudo identificar al usuario autenticado.');
    }
  }

  private assertDraftIdentityPair(id?: string, version?: number): void {
    if ((id === undefined) !== (version === undefined)) {
      throw new BadRequestException(
        'La identidad y la versión del borrador deben enviarse juntas.',
      );
    }
  }

  private normalizeDraftPayload(
    payload: PatientRegistrationDraftPayloadDto,
  ): Prisma.InputJsonObject {
    return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonObject;
  }

  private toDraftResponse(draft: PatientRegistrationDraft): PatientRegistrationDraftResponseDto {
    return {
      id: draft.id,
      payload: JSON.parse(JSON.stringify(draft.payload)) as PatientRegistrationDraftPayloadDto,
      version: draft.version,
      expiresAt: draft.expiresAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }
}

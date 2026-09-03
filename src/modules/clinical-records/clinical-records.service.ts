import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ClinicalRecordDraft,
  Prisma,
  RecordOrigin,
  RecordStatus,
  RecordType,
} from '@prisma/client';
import { parseClinicalDateFilter } from '../../common/validation/clinical-date';
import { PrismaService } from '../../database/prisma.service';
import { CorrectRecordDto } from './dto/correct-record.dto';
import { CreateRecordDto } from './dto/create-record.dto';
import { FindRecordsQueryDto } from './dto/find-records-query.dto';
import {
  CLINICAL_RECORD_SCHEMA_VERSION,
  validateClinicalRecordDetails,
} from './dto/record-details.dto';
import {
  RecordDraftPayloadDto,
  RecordDraftResponseDto,
  UpsertRecordDraftDto,
} from './dto/record-draft.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import { VoidRecordDto } from './dto/void-record.dto';
import {
  ClinicalRecordsRepository,
  RecordWithCount,
} from './repositories/clinical-records.repository';

const RECORD_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ProfessionalSnapshot {
  doctorName: string | null;
  professionalId: string | null;
  professionalNameSnapshot: string | null;
  professionalLicenseSnapshot: string | null;
}

interface ProfessionalInput {
  professionalId?: string | null;
  doctorName?: string | null;
  professionalLicense?: string | null;
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredText(value: string | null | undefined, property: string): string {
  const normalized = optionalText(value);
  if (!normalized) throw new BadRequestException(`${property} no puede estar vacío.`);
  return normalized;
}

function asInputJsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}

@Injectable()
export class ClinicalRecordsService {
  constructor(
    private readonly repo: ClinicalRecordsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async create(
    patientId: string,
    dto: CreateRecordDto,
    actorId: string,
  ): Promise<RecordResponseDto> {
    this.requireActor(actorId);
    const details = this.normalizeDetails(dto.recordType, dto.details);
    const schemaVersion = dto.schemaVersion ?? CLINICAL_RECORD_SCHEMA_VERSION;

    const record = await this.prisma.$transaction(async (tx) => {
      await this.requireActivePatient(patientId, tx);
      const professional = await this.resolveProfessional(dto, tx);
      const created = await this.repo.createInTransaction(
        {
          patientId,
          recordType: dto.recordType,
          // La procedencia de una entrada manual nunca se confía al cliente.
          origin: RecordOrigin.MANUAL,
          attendedAt: new Date(dto.attendedAt),
          summary: requiredText(dto.summary, 'summary'),
          notes: optionalText(dto.notes),
          details,
          schemaVersion,
          ...professional,
          service: optionalText(dto.service),
          preliminaryDiagnosis: optionalText(dto.preliminaryDiagnosis),
          plan: optionalText(dto.plan),
          priority: dto.priority ?? 'NORMAL',
          createdBy: actorId,
        },
        tx,
      );

      if (dto.draftId) {
        const consumed = await this.repo.deleteDraftByIdForActor(
          dto.draftId,
          patientId,
          actorId,
          tx,
        );
        if (!consumed) {
          throw new ConflictException(
            'El borrador ya no existe, expiró o pertenece a otro usuario. El registro no fue creado.',
          );
        }
      }

      return created;
    });

    return this.toResponse(record);
  }

  async findByPatient(
    patientId: string,
    query: FindRecordsQueryDto,
  ): Promise<{ data: RecordResponseDto[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = query.from ? parseClinicalDateFilter(query.from, 'from') : undefined;
    const to = query.to ? parseClinicalDateFilter(query.to, 'to') : undefined;

    const { records, total } = await this.repo.findByPatient(patientId, {
      recordType: query.recordType,
      status: query.status,
      origin: query.origin,
      from: from?.date,
      to: to?.date,
      toExclusive: to?.exclusive,
      page,
      limit,
    });

    return { data: records.map((record) => this.toResponse(record)), total, page, limit };
  }

  async findOne(patientId: string, id: string): Promise<RecordResponseDto> {
    const record = await this.repo.findByIdAndPatient(id, patientId);
    if (!record) throw new NotFoundException('Historia clínica no encontrada.');
    return this.toResponse(record);
  }

  async correct(
    patientId: string,
    id: string,
    dto: CorrectRecordDto,
    actorId: string,
  ): Promise<RecordResponseDto> {
    this.requireActor(actorId);

    const newRecord = await this.prisma.$transaction(async (tx) => {
      const original = await this.repo.findByIdAndPatient(id, patientId, tx);
      if (!original) throw new NotFoundException('Historia clínica no encontrada.');
      if (original.status !== RecordStatus.ACTIVE) {
        throw new ConflictException(
          `No se puede corregir un registro con estado ${original.status}.`,
        );
      }
      if (original.version !== dto.expectedVersion) {
        throw new ConflictException(
          'El registro cambió desde que fue abierto. Recarga la información antes de corregirlo.',
        );
      }

      const recordType = dto.recordType ?? original.recordType;
      if (dto.recordType && dto.recordType !== original.recordType && dto.details === undefined) {
        throw new BadRequestException(
          'details es obligatorio cuando una corrección cambia recordType.',
        );
      }
      const details =
        dto.details === undefined
          ? asInputJsonObject(original.details)
          : this.normalizeDetails(recordType, dto.details);
      const schemaVersion = dto.schemaVersion ?? original.schemaVersion;
      if (schemaVersion !== CLINICAL_RECORD_SCHEMA_VERSION) {
        throw new BadRequestException(`schemaVersion ${schemaVersion} no está soportada.`);
      }

      const professional = await this.resolveCorrectedProfessional(original, dto, tx);
      const marked = await this.repo.markCorrected(id, patientId, dto.expectedVersion, actorId, tx);
      if (!marked) {
        throw new ConflictException(
          'El registro fue modificado por otro usuario. La corrección no se guardó.',
        );
      }

      return this.repo.createInTransaction(
        {
          patientId,
          recordType,
          // Una corrección conserva la procedencia de la entrada original.
          origin: original.origin,
          attendedAt: dto.attendedAt ? new Date(dto.attendedAt) : original.attendedAt,
          summary: hasOwn(dto, 'summary') ? requiredText(dto.summary, 'summary') : original.summary,
          notes: hasOwn(dto, 'notes') ? optionalText(dto.notes) : original.notes,
          details,
          schemaVersion,
          ...professional,
          service: hasOwn(dto, 'service') ? optionalText(dto.service) : original.service,
          preliminaryDiagnosis: hasOwn(dto, 'preliminaryDiagnosis')
            ? optionalText(dto.preliminaryDiagnosis)
            : original.preliminaryDiagnosis,
          plan: hasOwn(dto, 'plan') ? optionalText(dto.plan) : original.plan,
          priority: dto.priority ?? original.priority,
          parentRecordId: id,
          createdBy: actorId,
        },
        tx,
      );
    });

    return this.toResponse(newRecord);
  }

  async void(
    patientId: string,
    id: string,
    dto: VoidRecordDto,
    actorId: string,
  ): Promise<RecordResponseDto> {
    this.requireActor(actorId);

    const voided = await this.prisma.$transaction(async (tx) => {
      const record = await this.repo.findByIdAndPatient(id, patientId, tx);
      if (!record) throw new NotFoundException('Historia clínica no encontrada.');
      if (record.status !== RecordStatus.ACTIVE) {
        throw new ConflictException(`No se puede anular un registro con estado ${record.status}.`);
      }
      if (record.version !== dto.expectedVersion) {
        throw new ConflictException(
          'El registro cambió desde que fue abierto. Recarga la información antes de anularlo.',
        );
      }

      const marked = await this.repo.markVoided(
        id,
        patientId,
        dto.expectedVersion,
        requiredText(dto.reason, 'reason'),
        actorId,
        tx,
      );
      if (!marked) {
        throw new ConflictException(
          'El registro fue modificado por otro usuario. La anulación no se guardó.',
        );
      }

      const updated = await this.repo.findByIdAndPatient(id, patientId, tx);
      if (!updated) throw new NotFoundException('Historia clínica no encontrada.');
      return updated;
    });

    return this.toResponse(voided);
  }

  async getCurrentDraft(
    patientId: string,
    actorId: string,
  ): Promise<RecordDraftResponseDto | null> {
    this.requireActor(actorId);
    const draft = await this.repo.findDraftByActorAndPatient(patientId, actorId);
    if (!draft) return null;
    if (draft.expiresAt.getTime() <= Date.now()) {
      await this.prisma.$transaction((tx) => this.repo.deleteDraftById(draft.id, tx));
      return null;
    }
    return this.toDraftResponse(draft);
  }

  async upsertCurrentDraft(
    patientId: string,
    dto: UpsertRecordDraftDto,
    actorId: string,
  ): Promise<RecordDraftResponseDto> {
    this.requireActor(actorId);
    const payload = this.normalizeDraftPayload(dto.payload);
    const expiresAt = new Date(Date.now() + RECORD_DRAFT_TTL_MS);

    try {
      const draft = await this.prisma.$transaction(async (tx) => {
        await this.requireActivePatient(patientId, tx);
        let current = await this.repo.findDraftByActorAndPatient(patientId, actorId, tx);
        if (current && current.expiresAt.getTime() <= Date.now()) {
          await this.repo.deleteDraftById(current.id, tx);
          current = null;
        }

        if (!current) {
          if (dto.expectedVersion !== undefined && dto.expectedVersion !== 0) {
            throw new ConflictException(
              'El borrador ya no existe. Recarga el formulario antes de guardar.',
            );
          }
          return this.repo.createDraft({ patientId, actorId, payload, expiresAt }, tx);
        }

        if (dto.expectedVersion === undefined) {
          throw new ConflictException(
            'expectedVersion es obligatorio al actualizar un borrador existente.',
          );
        }
        const updated = await this.repo.updateDraftCas(
          current.id,
          actorId,
          dto.expectedVersion,
          payload,
          expiresAt,
          tx,
        );
        if (!updated) {
          throw new ConflictException(
            'El borrador fue modificado en otra pestaña. Recarga antes de continuar.',
          );
        }
        return updated;
      });
      return this.toDraftResponse(draft);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Otro borrador fue creado simultáneamente. Recarga antes de continuar.',
        );
      }
      throw error;
    }
  }

  async deleteCurrentDraft(
    patientId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<void> {
    this.requireActor(actorId);
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.repo.findDraftByActorAndPatient(patientId, actorId, tx);
      if (!draft) return;
      if (draft.expiresAt.getTime() <= Date.now()) {
        await this.repo.deleteDraftById(draft.id, tx);
        return;
      }
      const deleted = await this.repo.deleteDraftCas(draft.id, actorId, expectedVersion, tx);
      if (!deleted) {
        throw new ConflictException(
          'El borrador fue modificado en otra pestaña. Recarga antes de eliminarlo.',
        );
      }
    });
  }

  private normalizeDetails(recordType: RecordType, details: unknown): Prisma.InputJsonObject {
    const result = validateClinicalRecordDetails(recordType, details);
    if (!result.value) {
      throw new BadRequestException({
        message: `details no cumple el esquema v${CLINICAL_RECORD_SCHEMA_VERSION} de ${recordType}.`,
        errors: result.errors,
      });
    }
    return result.value;
  }

  private normalizeDraftPayload(payload: RecordDraftPayloadDto): Prisma.InputJsonObject {
    const normalized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    if (payload.details !== undefined) {
      const result = validateClinicalRecordDetails(payload.recordType, payload.details, {
        partial: true,
      });
      if (!result.value) {
        throw new BadRequestException({
          message: 'El contenido parcial de details no es válido para el tipo seleccionado.',
          errors: result.errors,
        });
      }
      normalized.details = result.value;
    }
    normalized.schemaVersion = payload.schemaVersion ?? CLINICAL_RECORD_SCHEMA_VERSION;
    return normalized as Prisma.InputJsonObject;
  }

  private async requireActivePatient(
    patientId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const patient = await tx.patient.findUnique({
      where: { id: patientId },
      select: { isActive: true },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado.');
    if (!patient.isActive) {
      throw new ConflictException(
        'El paciente está desactivado. Reactívalo antes de registrar una atención.',
      );
    }
  }

  private async resolveProfessional(
    input: ProfessionalInput,
    tx: Prisma.TransactionClient,
  ): Promise<ProfessionalSnapshot> {
    const license = optionalText(input.professionalLicense);
    if (input.professionalId) {
      const professional = await tx.user.findUnique({
        where: { id: input.professionalId },
        select: { id: true, fullName: true, isActive: true },
      });
      if (!professional?.isActive) {
        throw new BadRequestException('El profesional seleccionado no existe o está inactivo.');
      }
      return {
        professionalId: professional.id,
        doctorName: professional.fullName,
        professionalNameSnapshot: professional.fullName,
        professionalLicenseSnapshot: license,
      };
    }

    const name = optionalText(input.doctorName);
    return {
      professionalId: null,
      doctorName: name,
      professionalNameSnapshot: name,
      professionalLicenseSnapshot: license,
    };
  }

  private async resolveCorrectedProfessional(
    original: RecordWithCount,
    dto: CorrectRecordDto,
    tx: Prisma.TransactionClient,
  ): Promise<ProfessionalSnapshot> {
    const touched =
      hasOwn(dto, 'professionalId') ||
      hasOwn(dto, 'doctorName') ||
      hasOwn(dto, 'professionalLicense');
    if (!touched) {
      return {
        professionalId: original.professionalId,
        doctorName: original.doctorName,
        professionalNameSnapshot: original.professionalNameSnapshot,
        professionalLicenseSnapshot: original.professionalLicenseSnapshot,
      };
    }

    return this.resolveProfessional(
      {
        professionalId: hasOwn(dto, 'professionalId')
          ? dto.professionalId
          : original.professionalId,
        doctorName: hasOwn(dto, 'doctorName') ? dto.doctorName : original.doctorName,
        professionalLicense: hasOwn(dto, 'professionalLicense')
          ? dto.professionalLicense
          : original.professionalLicenseSnapshot,
      },
      tx,
    );
  }

  private requireActor(actorId: string): void {
    if (!actorId?.trim()) {
      throw new UnauthorizedException('No se pudo identificar al usuario autenticado.');
    }
  }

  private toDraftResponse(draft: ClinicalRecordDraft): RecordDraftResponseDto {
    return {
      id: draft.id,
      patientId: draft.patientId,
      payload: asInputJsonObject(draft.payload) as Record<string, unknown>,
      version: draft.version,
      expiresAt: draft.expiresAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private toResponse(record: RecordWithCount): RecordResponseDto {
    return {
      id: record.id,
      patientId: record.patientId,
      recordType: record.recordType,
      origin: record.origin,
      status: record.status,
      attendedAt: record.attendedAt,
      summary: record.summary,
      notes: record.notes,
      details: asInputJsonObject(record.details) as Record<string, unknown>,
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
      correctionsCount: record._count.corrections,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      updatedAt: record.updatedAt,
      version: record.version,
    };
  }
}

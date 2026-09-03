import { Injectable } from '@nestjs/common';
import { DocumentType, Patient, PatientRegistrationDraft, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const clinicalHistoryExportArgs = {
  select: {
    id: true,
    documentType: true,
    documentNumber: true,
    firstName: true,
    lastName: true,
    dateOfBirth: true,
    sex: true,
    phone: true,
    email: true,
    address: true,
    clinicalRecords: {
      select: {
        id: true,
        recordType: true,
        origin: true,
        status: true,
        attendedAt: true,
        summary: true,
        notes: true,
        details: true,
        schemaVersion: true,
        doctorName: true,
        professionalId: true,
        professionalNameSnapshot: true,
        professionalLicenseSnapshot: true,
        service: true,
        preliminaryDiagnosis: true,
        plan: true,
        priority: true,
        parentRecordId: true,
        voidReason: true,
        createdAt: true,
        createdBy: true,
        updatedAt: true,
        updatedBy: true,
        version: true,
        attachments: {
          select: {
            id: true,
            assetId: true,
            sectionKey: true,
            caption: true,
            altText: true,
            sortOrder: true,
            createdBy: true,
            createdAt: true,
            asset: {
              select: {
                id: true,
                patientId: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                width: true,
                height: true,
                sha256: true,
                status: true,
                expiresAt: true,
                version: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ attendedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    },
    medicalDocuments: {
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        ocrText: true,
        correctedText: true,
        rejectReason: true,
        createdAt: true,
        processedAt: true,
        correctedAt: true,
        correctedById: true,
        reviewedAt: true,
        reviewedBy: true,
        validationChecklist: true,
        validationAttestedAt: true,
        createdBy: true,
        updatedBy: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  },
} satisfies Prisma.PatientDefaultArgs;

export type PatientClinicalHistoryExport = Prisma.PatientGetPayload<
  typeof clinicalHistoryExportArgs
>;

export interface FindManyOptions {
  search?: string;
  documentType?: DocumentType;
  documentNumber?: string;
  skip: number;
  take: number;
}

export interface PaginatedPatients {
  data: Patient[];
  total: number;
}

export interface PatientRegistrationDraftIdentity {
  id: string;
  version: number;
  actorId: string;
}

export interface UpsertPatientRegistrationDraftInput {
  actorId: string;
  expectedId?: string;
  expectedVersion?: number;
  payload: Prisma.InputJsonObject;
  expiresAt: Date;
}

@Injectable()
export class PatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.PatientUncheckedCreateInput,
    draft?: PatientRegistrationDraftIdentity,
  ): Promise<Patient | null> {
    if (!draft) return this.prisma.patient.create({ data });

    return this.prisma.$transaction(
      async (tx) => {
        const consumed = await tx.patientRegistrationDraft.deleteMany({
          where: {
            id: draft.id,
            actorId: draft.actorId,
            version: draft.version,
            expiresAt: { gt: new Date() },
          },
        });
        if (consumed.count !== 1) return null;
        return tx.patient.create({ data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findRegistrationDraftByActor(actorId: string): Promise<PatientRegistrationDraft | null> {
    return this.prisma.patientRegistrationDraft.findUnique({ where: { actorId } });
  }

  async upsertRegistrationDraft(
    input: UpsertPatientRegistrationDraftInput,
  ): Promise<PatientRegistrationDraft | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.patientRegistrationDraft.deleteMany({ where: { expiresAt: { lte: now } } });
        const current = await tx.patientRegistrationDraft.findUnique({
          where: { actorId: input.actorId },
        });

        if (!current) {
          if (input.expectedId !== undefined || input.expectedVersion !== undefined) return null;
          return tx.patientRegistrationDraft.create({
            data: {
              actorId: input.actorId,
              payload: input.payload,
              expiresAt: input.expiresAt,
            },
          });
        }

        if (input.expectedId !== current.id || input.expectedVersion !== current.version) {
          return null;
        }

        const updated = await tx.patientRegistrationDraft.updateMany({
          where: {
            id: current.id,
            actorId: input.actorId,
            version: input.expectedVersion,
            expiresAt: { gt: now },
          },
          data: {
            payload: input.payload,
            expiresAt: input.expiresAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return null;
        return tx.patientRegistrationDraft.findUnique({ where: { id: current.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deleteRegistrationDraft(identity: PatientRegistrationDraftIdentity): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.patientRegistrationDraft.deleteMany({ where: { expiresAt: { lte: now } } });
        const deleted = await tx.patientRegistrationDraft.deleteMany({
          where: {
            id: identity.id,
            actorId: identity.actorId,
            version: identity.version,
          },
        });
        if (deleted.count === 1) return true;
        const current = await tx.patientRegistrationDraft.findUnique({
          where: { actorId: identity.actorId },
          select: { id: true },
        });
        return current === null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async purgeExpiredRegistrationDrafts(now = new Date()): Promise<number> {
    const result = await this.prisma.patientRegistrationDraft.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  }

  async findMany(options: FindManyOptions): Promise<PaginatedPatients> {
    const where = this.buildWhere(options);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: options.skip,
        take: options.take,
      }),
      this.prisma.patient.count({ where }),
    ]);
    return { data, total };
  }

  async findById(id: string): Promise<Patient | null> {
    return this.prisma.patient.findUnique({ where: { id } });
  }

  async findClinicalHistoryForExport(id: string): Promise<PatientClinicalHistoryExport | null> {
    return this.prisma.$transaction(
      (transaction) =>
        transaction.patient.findUnique({
          where: { id },
          ...clinicalHistoryExportArgs,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findByDocument(
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<Patient | null> {
    return this.prisma.patient.findUnique({
      where: { documentType_documentNumber: { documentType, documentNumber } },
    });
  }

  async update(id: string, data: Prisma.PatientUpdateInput): Promise<Patient> {
    return this.prisma.patient.update({ where: { id }, data });
  }

  async deactivate(id: string): Promise<Patient> {
    return this.prisma.patient.update({ where: { id }, data: { isActive: false } });
  }

  async activate(id: string): Promise<Patient> {
    return this.prisma.patient.update({ where: { id }, data: { isActive: true } });
  }

  /** Indicadores para el mini-dashboard de la lista de pacientes. */
  async stats(): Promise<{
    total: number;
    active: number;
    newThisMonth: number;
    withPendingDocs: number;
    withRecentDocs: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [total, active, newThisMonth, pendingPatients, recentDocPatients] =
      await this.prisma.$transaction([
        this.prisma.patient.count(),
        this.prisma.patient.count({ where: { isActive: true } }),
        this.prisma.patient.count({ where: { createdAt: { gte: startOfMonth } } }),
        this.prisma.medicalDocument.findMany({
          where: {
            status: { in: ['PENDING', 'PROCESSING', 'PROCESSED'] },
            patient: { isActive: true },
          },
          select: { patientId: true },
          distinct: ['patientId'],
        }),
        this.prisma.medicalDocument.findMany({
          where: { createdAt: { gte: last30Days }, patient: { isActive: true } },
          select: { patientId: true },
          distinct: ['patientId'],
        }),
      ]);

    return {
      total,
      active,
      newThisMonth,
      withPendingDocs: pendingPatients.length,
      withRecentDocs: recentDocPatients.length,
    };
  }

  private buildWhere(options: FindManyOptions): Prisma.PatientWhereInput {
    const conditions: Prisma.PatientWhereInput[] = [{ isActive: true }];

    if (options.documentType && options.documentNumber) {
      conditions.push({
        documentType: options.documentType,
        documentNumber: options.documentNumber,
      });
    } else if (options.search) {
      const term = options.search;
      conditions.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { documentNumber: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    return { AND: conditions };
  }
}

import { Injectable } from '@nestjs/common';
import {
  ClinicalRecordDraft,
  Prisma,
  RecordOrigin,
  RecordStatus,
  RecordType,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const withCountArgs = {
  include: {
    _count: { select: { corrections: true } },
    attachments: {
      include: { asset: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    },
  },
} satisfies Prisma.ClinicalRecordDefaultArgs;

export type RecordWithCount = Prisma.ClinicalRecordGetPayload<typeof withCountArgs>;

export interface FindRecordsFilters {
  recordType?: RecordType;
  status?: RecordStatus;
  origin?: RecordOrigin;
  from?: Date;
  to?: Date;
  toExclusive?: boolean;
  page: number;
  limit: number;
}

@Injectable()
export class ClinicalRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ClinicalRecordUncheckedCreateInput): Promise<RecordWithCount> {
    return this.prisma.clinicalRecord.create({ data, ...withCountArgs });
  }

  async findByPatient(
    patientId: string,
    filters: FindRecordsFilters,
  ): Promise<{ records: RecordWithCount[]; total: number }> {
    const where: Prisma.ClinicalRecordWhereInput = {
      patientId,
      ...(filters.recordType && { recordType: filters.recordType }),
      ...(filters.status ? { status: filters.status } : { status: RecordStatus.ACTIVE }),
      ...(filters.origin && { origin: filters.origin }),
      ...(filters.from || filters.to
        ? {
            attendedAt: {
              ...(filters.from && { gte: filters.from }),
              ...(filters.to && (filters.toExclusive ? { lt: filters.to } : { lte: filters.to })),
            },
          }
        : {}),
    };

    const skip = (filters.page - 1) * filters.limit;

    const [records, total] = await this.prisma.$transaction([
      this.prisma.clinicalRecord.findMany({
        where,
        orderBy: { attendedAt: 'desc' },
        skip,
        take: filters.limit,
        ...withCountArgs,
      }),
      this.prisma.clinicalRecord.count({ where }),
    ]);

    return { records, total };
  }

  async findByIdAndPatient(
    id: string,
    patientId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RecordWithCount | null> {
    const client = tx ?? this.prisma;
    return client.clinicalRecord.findFirst({
      where: { id, patientId },
      ...withCountArgs,
    });
  }

  async markCorrected(
    id: string,
    patientId: string,
    expectedVersion: number,
    updatedBy: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.clinicalRecord.updateMany({
      where: {
        id,
        patientId,
        status: RecordStatus.ACTIVE,
        version: expectedVersion,
      },
      data: {
        status: RecordStatus.CORRECTED,
        ...(updatedBy && { updatedBy }),
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async createInTransaction(
    data: Prisma.ClinicalRecordUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ): Promise<RecordWithCount> {
    return tx.clinicalRecord.create({ data, ...withCountArgs });
  }

  async markVoided(
    id: string,
    patientId: string,
    expectedVersion: number,
    voidReason: string,
    updatedBy: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.clinicalRecord.updateMany({
      where: {
        id,
        patientId,
        status: RecordStatus.ACTIVE,
        version: expectedVersion,
      },
      data: {
        status: RecordStatus.VOIDED,
        voidReason,
        ...(updatedBy && { updatedBy }),
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async findDraftByActorAndPatient(
    patientId: string,
    actorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ClinicalRecordDraft | null> {
    const client = tx ?? this.prisma;
    return client.clinicalRecordDraft.findUnique({
      where: { patientId_actorId: { patientId, actorId } },
    });
  }

  async createDraft(
    data: Prisma.ClinicalRecordDraftUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ): Promise<ClinicalRecordDraft> {
    return tx.clinicalRecordDraft.create({ data });
  }

  async updateDraftCas(
    id: string,
    actorId: string,
    expectedVersion: number,
    payload: Prisma.InputJsonValue,
    expiresAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<ClinicalRecordDraft | null> {
    const updated = await tx.clinicalRecordDraft.updateMany({
      where: { id, actorId, version: expectedVersion },
      data: { payload, expiresAt, version: { increment: 1 } },
    });
    if (updated.count !== 1) return null;
    return tx.clinicalRecordDraft.findUnique({ where: { id } });
  }

  async deleteDraftCas(
    id: string,
    actorId: string,
    expectedVersion: number,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const deleted = await tx.clinicalRecordDraft.deleteMany({
      where: { id, actorId, version: expectedVersion },
    });
    return deleted.count === 1;
  }

  async deleteDraftByIdForActor(
    id: string,
    patientId: string,
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const deleted = await tx.clinicalRecordDraft.deleteMany({
      where: { id, patientId, actorId, expiresAt: { gt: new Date() } },
    });
    return deleted.count === 1;
  }

  async deleteDraftById(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.clinicalRecordDraft.deleteMany({ where: { id } });
  }
}

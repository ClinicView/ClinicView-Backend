import { Injectable } from '@nestjs/common';
import { ClinicalRecord, Prisma, RecordOrigin, RecordStatus, RecordType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const withCountArgs = {
  include: { _count: { select: { corrections: true } } },
} as const;

export type RecordWithCount = Prisma.ClinicalRecordGetPayload<typeof withCountArgs>;

export interface FindRecordsFilters {
  recordType?: RecordType;
  status?: RecordStatus;
  origin?: RecordOrigin;
  from?: Date;
  to?: Date;
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
              ...(filters.to && { lte: filters.to }),
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

  async findByIdAndPatient(id: string, patientId: string): Promise<RecordWithCount | null> {
    return this.prisma.clinicalRecord.findFirst({
      where: { id, patientId },
      ...withCountArgs,
    });
  }

  async markCorrected(
    id: string,
    updatedBy: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.clinicalRecord.update({
      where: { id },
      data: {
        status: RecordStatus.CORRECTED,
        ...(updatedBy && { updatedBy }),
        version: { increment: 1 },
      },
    });
  }

  async createInTransaction(
    data: Prisma.ClinicalRecordUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ): Promise<RecordWithCount> {
    return tx.clinicalRecord.create({ data, ...withCountArgs });
  }

  async markVoided(
    id: string,
    voidReason: string,
    updatedBy: string | undefined,
  ): Promise<ClinicalRecord> {
    return this.prisma.clinicalRecord.update({
      where: { id },
      data: {
        status: RecordStatus.VOIDED,
        voidReason,
        ...(updatedBy && { updatedBy }),
        version: { increment: 1 },
      },
    });
  }
}

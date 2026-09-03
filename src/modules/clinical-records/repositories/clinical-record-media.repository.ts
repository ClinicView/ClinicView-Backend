import { Injectable } from '@nestjs/common';
import { ClinicalMediaAsset, ClinicalMediaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ClinicalRecordMediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isPatientActive(patientId: string): Promise<boolean | null> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { isActive: true },
    });
    return patient?.isActive ?? null;
  }

  async create(
    data: Prisma.ClinicalMediaAssetUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ClinicalMediaAsset> {
    const client = tx ?? this.prisma;
    return client.clinicalMediaAsset.create({ data });
  }

  async findByIdAndPatient(
    id: string,
    patientId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ClinicalMediaAsset | null> {
    const client = tx ?? this.prisma;
    return client.clinicalMediaAsset.findFirst({ where: { id, patientId } });
  }

  async findManyByIdsAndPatient(
    ids: string[],
    patientId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ClinicalMediaAsset[]> {
    if (ids.length === 0) return [];
    return tx.clinicalMediaAsset.findMany({
      where: { id: { in: ids }, patientId },
      orderBy: { id: 'asc' },
    });
  }

  async transitionTemporaryToAttached(
    ids: string[],
    patientId: string,
    actorId: string,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (ids.length === 0) return true;
    const result = await tx.clinicalMediaAsset.updateMany({
      where: {
        id: { in: ids },
        patientId,
        uploadedBy: actorId,
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { gt: now },
      },
      data: {
        status: ClinicalMediaStatus.ATTACHED,
        expiresAt: null,
        version: { increment: 1 },
      },
    });
    return result.count === ids.length;
  }

  async getTemporaryQuota(
    patientId: string,
    actorId: string,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ count: number; sizeBytes: number }> {
    const aggregate = await tx.clinicalMediaAsset.aggregate({
      where: {
        patientId,
        uploadedBy: actorId,
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { gt: now },
      },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    return {
      count: aggregate._count._all,
      sizeBytes: aggregate._sum.sizeBytes ?? 0,
    };
  }

  async extendTemporaryExpiry(
    ids: string[],
    patientId: string,
    actorId: string,
    now: Date,
    expiresAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (ids.length === 0) return true;
    const result = await tx.clinicalMediaAsset.updateMany({
      where: {
        id: { in: ids },
        patientId,
        uploadedBy: actorId,
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { gt: now },
      },
      data: { expiresAt },
    });
    return result.count === ids.length;
  }

  async createAttachments(
    data: Prisma.ClinicalRecordAttachmentCreateManyInput[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (data.length === 0) return;
    await tx.clinicalRecordAttachment.createMany({ data });
  }

  async findExpiredTemporary(limit: number): Promise<ClinicalMediaAsset[]> {
    return this.prisma.clinicalMediaAsset.findMany({
      where: {
        status: ClinicalMediaStatus.TEMPORARY,
        expiresAt: { lte: new Date() },
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async deleteTemporaryCas(
    asset: Pick<ClinicalMediaAsset, 'id' | 'patientId' | 'uploadedBy' | 'version'>,
    tx: Prisma.TransactionClient,
    expiredBefore?: Date,
  ): Promise<boolean> {
    const result = await tx.clinicalMediaAsset.deleteMany({
      where: {
        id: asset.id,
        patientId: asset.patientId,
        uploadedBy: asset.uploadedBy,
        status: ClinicalMediaStatus.TEMPORARY,
        version: asset.version,
        ...(expiredBefore && { expiresAt: { lte: expiredBefore } }),
      },
    });
    return result.count === 1;
  }
}

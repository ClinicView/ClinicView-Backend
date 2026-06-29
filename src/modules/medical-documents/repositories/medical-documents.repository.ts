import { Injectable } from '@nestjs/common';
import { DocumentStatus, MedicalDocument, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface FindDocumentsFilters {
  status?: DocumentStatus;
  page: number;
  limit: number;
}

export interface UpdateStatusExtra {
  ocrText?: string | null;
  nerEntities?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  correctedText?: string | null;
  correctedEntities?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  correctedAt?: Date | null;
  correctedById?: string | null;
  rejectReason?: string | null;
  processedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string | null;
  updatedBy?: string | null;
}

@Injectable()
export class MedicalDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.MedicalDocumentUncheckedCreateInput): Promise<MedicalDocument> {
    return this.prisma.medicalDocument.create({ data });
  }

  async findByPatient(
    patientId: string,
    filters: FindDocumentsFilters,
  ): Promise<{ documents: MedicalDocument[]; total: number }> {
    const where: Prisma.MedicalDocumentWhereInput = {
      patientId,
      ...(filters.status && { status: filters.status }),
    };
    const skip = (filters.page - 1) * filters.limit;

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);

    return { documents, total };
  }

  async findByIdAndPatient(id: string, patientId: string): Promise<MedicalDocument | null> {
    return this.prisma.medicalDocument.findFirst({ where: { id, patientId } });
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    extra?: UpdateStatusExtra,
  ): Promise<MedicalDocument> {
    return this.prisma.medicalDocument.update({
      where: { id },
      data: { status, ...extra, version: { increment: 1 } },
    });
  }

  async saveCorrection(
    id: string,
    data: {
      correctedText?: string | null;
      correctedEntities?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      correctedAt: Date;
      correctedById?: string | null;
      updatedBy?: string | null;
    },
  ): Promise<MedicalDocument> {
    return this.prisma.medicalDocument.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
    });
  }
}

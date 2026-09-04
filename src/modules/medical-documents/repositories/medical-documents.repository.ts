import { Injectable } from '@nestjs/common';
import { DocumentStatus, Prisma } from '@prisma/client';
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
  metrics?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  ocrConfidence?: number | null;
  confidenceLevel?: string | null;
  processedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string | null;
  updatedBy?: string | null;
}

export interface SaveCorrectionData {
  correctedText?: string | null;
  correctedEntities?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  correctedAt: Date;
  correctedById: string;
  updatedBy: string;
}

export interface ValidateWithCorrectionData {
  correctedText: string;
  correctedEntities: Prisma.InputJsonValue;
  correctedAt?: Date;
  correctedById?: string | null;
  reviewedAt: Date;
  reviewedBy: string;
  validationChecklist: Prisma.InputJsonValue;
  validationAttestedAt: Date;
  updatedBy: string;
}

export interface RejectDocumentData {
  rejectReason: string;
  reviewedAt: Date;
  reviewedBy: string;
  updatedBy: string;
}

const medicalDocumentWithAssigneeArgs = {
  include: {
    assignedReviewer: {
      select: { id: true, username: true, fullName: true, profession: true },
    },
  },
} satisfies Prisma.MedicalDocumentDefaultArgs;

export type MedicalDocumentWithAssignee = Prisma.MedicalDocumentGetPayload<
  typeof medicalDocumentWithAssigneeArgs
>;

@Injectable()
export class MedicalDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.MedicalDocumentUncheckedCreateInput): Promise<MedicalDocumentWithAssignee> {
    return this.prisma.medicalDocument.create({ data, ...medicalDocumentWithAssigneeArgs });
  }

  async findByPatient(
    patientId: string,
    filters: FindDocumentsFilters,
  ): Promise<{ documents: MedicalDocumentWithAssignee[]; total: number }> {
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
        ...medicalDocumentWithAssigneeArgs,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);

    return { documents, total };
  }

  async findByIdAndPatient(id: string, patientId: string): Promise<MedicalDocumentWithAssignee | null> {
    return this.prisma.medicalDocument.findFirst({
      where: { id, patientId },
      ...medicalDocumentWithAssigneeArgs,
    });
  }

  /**
   * Marca como FAILED los documentos que quedaron en PROCESSING tras un
   * reinicio del servidor (el OCR en segundo plano murió con el proceso).
   */
  async failStaleProcessing(): Promise<number> {
    const result = await this.prisma.medicalDocument.updateMany({
      where: { status: DocumentStatus.PROCESSING },
      data: { status: DocumentStatus.FAILED },
    });
    return result.count;
  }

  async isPatientActive(patientId: string): Promise<boolean> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { isActive: true },
    });
    return patient?.isActive ?? false;
  }

  /** Búsqueda por palabra clave en el texto OCR/corregido del paciente. */
  async searchByPatient(
    patientId: string,
    keyword: string,
    page: number,
    limit: number,
  ): Promise<{ documents: MedicalDocumentWithAssignee[]; total: number }> {
    const where: Prisma.MedicalDocumentWhereInput = {
      patientId,
      OR: [
        { ocrText: { contains: keyword, mode: 'insensitive' } },
        { correctedText: { contains: keyword, mode: 'insensitive' } },
        { originalName: { contains: keyword, mode: 'insensitive' } },
      ],
    };
    const skip = (page - 1) * limit;

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        ...medicalDocumentWithAssigneeArgs,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);

    return { documents, total };
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    extra?: UpdateStatusExtra,
  ): Promise<MedicalDocumentWithAssignee> {
    return this.prisma.medicalDocument.update({
      where: { id },
      data: { status, ...extra, version: { increment: 1 } },
      ...medicalDocumentWithAssigneeArgs,
    });
  }

  async saveCorrection(
    id: string,
    patientId: string,
    expectedVersion: number,
    assignedReviewerId: string,
    data: SaveCorrectionData,
  ): Promise<MedicalDocumentWithAssignee | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.medicalDocument.updateMany({
        where: {
          id,
          patientId,
          status: DocumentStatus.PROCESSED,
          assignedReviewerId,
          version: expectedVersion,
        },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count !== 1) return null;
      return tx.medicalDocument.findUnique({ where: { id }, ...medicalDocumentWithAssigneeArgs });
    });
  }

  /**
   * Persiste la versión final y la valida en la misma transacción.
   * El predicado por estado + versión funciona como compare-and-swap: si
   * otro revisor guardó o validó antes, no se modifica ninguna columna.
   */
  async validateWithCorrection(
    id: string,
    patientId: string,
    expectedVersion: number,
    assignedReviewerId: string,
    data: ValidateWithCorrectionData,
  ): Promise<MedicalDocumentWithAssignee | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.medicalDocument.updateMany({
        where: {
          id,
          patientId,
          status: DocumentStatus.PROCESSED,
          assignedReviewerId,
          version: expectedVersion,
        },
        data: {
          ...data,
          status: DocumentStatus.VALIDATED,
          validationAttested: true,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) return null;
      return tx.medicalDocument.findUnique({ where: { id }, ...medicalDocumentWithAssigneeArgs });
    });
  }

  async rejectReviewedVersion(
    id: string,
    patientId: string,
    expectedVersion: number,
    assignedReviewerId: string,
    data: RejectDocumentData,
  ): Promise<MedicalDocumentWithAssignee | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.medicalDocument.updateMany({
        where: {
          id,
          patientId,
          OR: [
            { status: DocumentStatus.PENDING },
            { status: DocumentStatus.PROCESSED, assignedReviewerId },
          ],
          version: expectedVersion,
        },
        data: {
          ...data,
          status: DocumentStatus.REJECTED,
          validationChecklist: Prisma.DbNull,
          validationAttested: false,
          validationAttestedAt: null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) return null;
      return tx.medicalDocument.findUnique({ where: { id }, ...medicalDocumentWithAssigneeArgs });
    });
  }
}

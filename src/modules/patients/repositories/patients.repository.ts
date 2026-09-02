import { Injectable } from '@nestjs/common';
import { DocumentType, Patient, Prisma } from '@prisma/client';
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
        doctorName: true,
        service: true,
        preliminaryDiagnosis: true,
        plan: true,
        priority: true,
        parentRecordId: true,
        voidReason: true,
        createdAt: true,
        updatedAt: true,
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
        reviewedAt: true,
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

@Injectable()
export class PatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.PatientCreateInput): Promise<Patient> {
    return this.prisma.patient.create({ data });
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

  async findClinicalHistoryForExport(
    id: string,
  ): Promise<PatientClinicalHistoryExport | null> {
    return this.prisma.patient.findUnique({
      where: { id },
      ...clinicalHistoryExportArgs,
    });
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

import { Injectable } from '@nestjs/common';
import { DocumentType, Patient, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

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

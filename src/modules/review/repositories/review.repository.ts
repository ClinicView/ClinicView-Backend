import { Injectable } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface ReviewQueueFilters {
  page: number;
  limit: number;
}

const patientSelect = {
  id: true,
  firstName: true,
  lastName: true,
  documentType: true,
  documentNumber: true,
} as const;

@Injectable()
export class ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findQueue(filters: ReviewQueueFilters) {
    const skip = (filters.page - 1) * filters.limit;
    // Los documentos de pacientes desactivados no entran a la cola de trabajo.
    const where = {
      status: DocumentStatus.PROCESSED,
      patient: { isActive: true },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where,
        include: { patient: { select: patientSelect } },
        orderBy: { processedAt: 'asc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);

    return { items, total };
  }
}

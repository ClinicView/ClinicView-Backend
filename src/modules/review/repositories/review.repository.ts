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

    const [items, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where: { status: DocumentStatus.PROCESSED },
        include: { patient: { select: patientSelect } },
        orderBy: { processedAt: 'asc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.medicalDocument.count({
        where: { status: DocumentStatus.PROCESSED },
      }),
    ]);

    return { items, total };
  }
}

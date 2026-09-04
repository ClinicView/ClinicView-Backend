import { Injectable } from '@nestjs/common';
import { DocumentStatus, Prisma, ReviewPriority } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { ReviewQueueScope } from '../dto/find-review-queue-query.dto';

export interface ReviewQueueFilters {
  page: number;
  limit: number;
  actorId: string;
  scope: ReviewQueueScope;
  priority?: ReviewPriority;
}

const hasPermission = (key: string): Prisma.UserWhereInput => ({
  userRoles: {
    some: {
      role: {
        rolePermissions: { some: { permission: { key } } },
      },
    },
  },
});

const eligibleReviewerWhere = (userId?: string): Prisma.UserWhereInput => ({
  ...(userId && { id: userId }),
  isActive: true,
  AND: [
    hasPermission('review.read'),
    hasPermission('documents.read'),
    hasPermission('documents.validate'),
  ],
});

function isSerializableConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
}

const patientSelect = {
  id: true,
  firstName: true,
  lastName: true,
  documentType: true,
  documentNumber: true,
} as const;

export const reviewAssigneeSelect = {
  id: true,
  username: true,
  fullName: true,
  profession: true,
} as const;

const queueItemArgs = {
  include: {
    patient: { select: patientSelect },
    assignedReviewer: { select: reviewAssigneeSelect },
  },
} satisfies Prisma.MedicalDocumentDefaultArgs;

export type ReviewQueueDocument = Prisma.MedicalDocumentGetPayload<typeof queueItemArgs>;

@Injectable()
export class ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findQueue(filters: ReviewQueueFilters) {
    const skip = (filters.page - 1) * filters.limit;
    // Los documentos de pacientes desactivados no entran a la cola de trabajo.
    const assignmentWhere: Prisma.MedicalDocumentWhereInput =
      filters.scope === 'MINE'
        ? { assignedReviewerId: filters.actorId }
        : filters.scope === 'UNASSIGNED'
          ? { assignedReviewerId: null }
          : filters.scope === 'AVAILABLE'
            ? { OR: [{ assignedReviewerId: null }, { assignedReviewerId: filters.actorId }] }
            : {};
    const where: Prisma.MedicalDocumentWhereInput = {
      status: DocumentStatus.PROCESSED,
      patient: { isActive: true },
      ...(filters.priority && { reviewPriority: filters.priority }),
      ...assignmentWhere,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where,
        ...queueItemArgs,
        orderBy: [
          { reviewPriority: 'asc' },
          { processedAt: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        skip,
        take: filters.limit,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);

    return { items, total };
  }

  async findEligibleAssignees(query: string, limit = 20) {
    return this.prisma.user.findMany({
      where: {
        ...eligibleReviewerWhere(),
        ...(query && {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { username: { contains: query, mode: 'insensitive' } },
            { profession: { contains: query, mode: 'insensitive' } },
          ],
        }),
      },
      select: reviewAssigneeSelect,
      orderBy: [{ fullName: 'asc' }, { username: 'asc' }],
      take: limit,
    });
  }

  async isEligibleAssignee(userId: string): Promise<boolean> {
    const reviewer = await this.prisma.user.findFirst({
      where: eligibleReviewerWhere(userId),
      select: { id: true },
    });
    return reviewer !== null;
  }

  async findDocument(id: string): Promise<ReviewQueueDocument | null> {
    return this.prisma.medicalDocument.findUnique({ where: { id }, ...queueItemArgs });
  }

  async claim(id: string, assigneeId: string, expectedVersion: number): Promise<ReviewQueueDocument | null> {
    return this.updateAssignment(
      id,
      expectedVersion,
      { assignedReviewerId: null },
      { assignedReviewerId: assigneeId, assignedAt: new Date(), updatedBy: assigneeId },
      assigneeId,
    );
  }

  async assign(
    id: string,
    assigneeId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<ReviewQueueDocument | null> {
    return this.updateAssignment(
      id,
      expectedVersion,
      {},
      { assignedReviewerId: assigneeId, assignedAt: new Date(), updatedBy: actorId },
      assigneeId,
    );
  }

  async release(id: string, expectedVersion: number, actorId: string): Promise<ReviewQueueDocument | null> {
    return this.updateAssignment(
      id,
      expectedVersion,
      { assignedReviewerId: { not: null } },
      { assignedReviewerId: null, assignedAt: null, updatedBy: actorId },
    );
  }

  async updatePriority(
    id: string,
    priority: ReviewPriority,
    expectedVersion: number,
    actorId: string,
  ): Promise<ReviewQueueDocument | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.medicalDocument.updateMany({
        where: { id, status: DocumentStatus.PROCESSED, version: expectedVersion },
        data: { reviewPriority: priority, updatedBy: actorId, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      return tx.medicalDocument.findUnique({ where: { id }, ...queueItemArgs });
    });
  }

  private async updateAssignment(
    id: string,
    expectedVersion: number,
    predicate: Prisma.MedicalDocumentWhereInput,
    data: Pick<
      Prisma.MedicalDocumentUncheckedUpdateInput,
      'assignedReviewerId' | 'assignedAt' | 'updatedBy'
    >,
    eligibleAssigneeId?: string,
  ): Promise<ReviewQueueDocument | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (eligibleAssigneeId) {
            const eligible = await tx.user.findFirst({
              where: eligibleReviewerWhere(eligibleAssigneeId),
              select: { id: true },
            });
            if (!eligible) return null;
          }

          const updated = await tx.medicalDocument.updateMany({
            where: {
              id,
              status: DocumentStatus.PROCESSED,
              version: expectedVersion,
              ...predicate,
            },
            data: { ...data, version: { increment: 1 } },
          });
          if (updated.count !== 1) return null;
          return tx.medicalDocument.findUnique({ where: { id }, ...queueItemArgs });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializableConflict(error)) return null;
      throw error;
    }
  }
}

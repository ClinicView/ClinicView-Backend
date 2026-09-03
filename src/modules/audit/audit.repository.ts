import { Injectable } from '@nestjs/common';
import { AuditEvent, AuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface FindAuditEventsInput {
  cursor?: string;
  limit: number;
  action?: string;
  outcome?: AuditOutcome;
  actorId?: string;
  patientId?: string;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AuditEventUncheckedCreateInput): Promise<AuditEvent> {
    return this.prisma.auditEvent.create({ data });
  }

  findById(id: string): Promise<Pick<AuditEvent, 'id'> | null> {
    return this.prisma.auditEvent.findUnique({ where: { id }, select: { id: true } });
  }

  async findMany(input: FindAuditEventsInput): Promise<{
    data: AuditEvent[];
    nextCursor: string | null;
  }> {
    const where: Prisma.AuditEventWhereInput = {
      ...(input.action && { action: input.action }),
      ...(input.outcome && { outcome: input.outcome }),
      ...(input.actorId && { actorId: input.actorId }),
      ...(input.patientId && { patientId: input.patientId }),
      ...(input.resourceType && { resourceType: input.resourceType }),
      ...(input.resourceId && { resourceId: input.resourceId }),
      ...(input.requestId && { requestId: input.requestId }),
      ...(input.from || input.to
        ? {
            occurredAt: {
              ...(input.from && { gte: input.from }),
              ...(input.to && { lte: input.to }),
            },
          }
        : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const data = rows.slice(0, input.limit);
    return {
      data,
      nextCursor: rows.length > input.limit ? (data.at(-1)?.id ?? null) : null,
    };
  }
}

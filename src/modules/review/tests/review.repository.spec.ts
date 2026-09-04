import { DocumentStatus, Prisma, ReviewPriority } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ReviewRepository } from '../repositories/review.repository';

describe('ReviewRepository', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const updateMany = jest.fn();
  const findUnique = jest.fn();
  const findManyUsers = jest.fn();
  const findFirstUser = jest.fn();
  const transactionClient = {
    medicalDocument: { updateMany, findUnique },
    user: { findFirst: findFirstUser },
  };
  const prisma = {
    medicalDocument: { findMany, count },
    user: { findMany: findManyUsers, findFirst: findFirstUser },
    $transaction: jest.fn(async (operation: unknown) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      return (operation as (client: typeof transactionClient) => Promise<unknown>)(transactionClient);
    }),
  } as unknown as PrismaService;
  const repository = new ReviewRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findFirstUser.mockResolvedValue({ id: 'reviewer-uuid' });
  });

  it('AVAILABLE incluye documentos libres y asignados al actor, ordenados por prioridad y antiguedad', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await repository.findQueue({
      page: 1,
      limit: 20,
      actorId: 'actor-uuid',
      scope: 'AVAILABLE',
      priority: ReviewPriority.HIGH,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: DocumentStatus.PROCESSED,
        patient: { isActive: true },
        reviewPriority: ReviewPriority.HIGH,
        OR: [{ assignedReviewerId: null }, { assignedReviewerId: 'actor-uuid' }],
      },
      orderBy: [
        { reviewPriority: 'asc' },
        { processedAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      skip: 0,
      take: 20,
    }));
  });

  it('ALL no restringe por responsable y conserva el acceso de consulta a toda la cola', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await repository.findQueue({
      page: 2,
      limit: 10,
      actorId: 'actor-uuid',
      scope: 'ALL',
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: DocumentStatus.PROCESSED,
        patient: { isActive: true },
      },
      skip: 10,
      take: 10,
    }));
  });

  it('solo ofrece usuarios activos que pueden ver la cola, abrir y validar documentos', async () => {
    findManyUsers.mockResolvedValue([]);

    await repository.findEligibleAssignees('maria');

    expect(findManyUsers).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        AND: [
          expect.objectContaining({
            userRoles: expect.objectContaining({
              some: expect.objectContaining({
                role: expect.objectContaining({
                  rolePermissions: { some: { permission: { key: 'review.read' } } },
                }),
              }),
            }),
          }),
          expect.objectContaining({
            userRoles: expect.objectContaining({
              some: expect.objectContaining({
                role: expect.objectContaining({
                  rolePermissions: { some: { permission: { key: 'documents.read' } } },
                }),
              }),
            }),
          }),
          expect.objectContaining({
            userRoles: expect.objectContaining({
              some: expect.objectContaining({
                role: expect.objectContaining({
                  rolePermissions: { some: { permission: { key: 'documents.validate' } } },
                }),
              }),
            }),
          }),
        ],
      }),
    }));
  });

  it('claim usa estado, version y ausencia de responsable como compare-and-swap', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({
      id: 'document-uuid',
      assignedReviewerId: 'reviewer-uuid',
    });

    const result = await repository.claim('document-uuid', 'reviewer-uuid', 3);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'document-uuid',
        status: DocumentStatus.PROCESSED,
        version: 3,
        assignedReviewerId: null,
      },
      data: expect.objectContaining({
        assignedReviewerId: 'reviewer-uuid',
        assignedAt: expect.any(Date),
        updatedBy: 'reviewer-uuid',
        version: { increment: 1 },
      }),
    });
    expect(result).toEqual(expect.objectContaining({ assignedReviewerId: 'reviewer-uuid' }));
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it('revalida al revisor dentro de la transacción antes de confirmar el claim', async () => {
    findFirstUser.mockResolvedValueOnce(null);

    const result = await repository.claim('document-uuid', 'reviewer-uuid', 3);

    expect(result).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('no devuelve una version si pierde el compare-and-swap', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.release('document-uuid', 2, 'actor-uuid');

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

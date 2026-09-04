import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RolesRepository } from '../repositories/roles.repository';

const version = new Date('2026-01-02T00:00:00.000Z');

describe('RolesRepository permission replacement', () => {
  it('reemplaza la matriz y revoca sesiones de miembros en una transacción serializable', async () => {
    const role = { id: 'role-id', key: 'CUSTOM', updatedAt: version };
    const tx = {
      role: {
        findUnique: jest.fn().mockResolvedValue(role),
        update: jest.fn().mockResolvedValue(role),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...role,
          name: 'Custom', description: null, createdAt: version,
          rolePermissions: [], _count: { userRoles: 1 },
        }),
      },
      permission: {
        findMany: jest.fn().mockResolvedValue([{ id: 'permission-id', key: 'patients.read' }]),
      },
      userRole: { findMany: jest.fn().mockResolvedValue([{ userId: 'user-id' }]) },
      rolePermission: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      medicalDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const repository = new RolesRepository(prisma as unknown as PrismaService);

    const result = await repository.replacePermissions(
      role.id,
      ['patients.read'],
      version,
      'actor-id',
    );

    expect(result.status).toBe('updated');
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: role.id } });
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: role.id, permissionId: 'permission-id' }],
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-id'] } },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalled();
    expect(tx.medicalDocument.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PROCESSED',
        assignedReviewerId: { in: ['user-id'] },
      },
      data: {
        assignedReviewerId: null,
        assignedAt: null,
        updatedBy: 'actor-id',
        version: { increment: 1 },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('no escribe cuando la versión conocida está obsoleta', async () => {
    const tx = {
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-id', updatedAt: new Date() }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const repository = new RolesRepository(prisma as unknown as PrismaService);
    await expect(repository.replacePermissions('role-id', [], version, 'actor-id')).resolves.toEqual({
      status: 'stale',
    });
  });
});

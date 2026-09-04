import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UsersRepository } from '../repositories/users.repository';

const user = {
  id: 'user-id',
  isActive: true,
  userRoles: [{ role: { key: 'MEDICO', name: 'Médico' } }],
};

describe('UsersRepository protected mutations', () => {
  let repository: UsersRepository;
  let tx: {
    user: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
    };
    role: { findUnique: jest.Mock };
    userRole: { deleteMany: jest.Mock; create: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    medicalDocument: { updateMany: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  beforeEach(() => {
    tx = {
      user: {
        create: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({ ...user, isActive: false }),
        findUnique: jest.fn().mockResolvedValue(user),
        findUniqueOrThrow: jest.fn().mockResolvedValue(user),
        findFirst: jest.fn().mockResolvedValue({ id: 'user-id' }),
        count: jest.fn().mockResolvedValue(2),
      },
      role: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'MEDICO',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
      userRole: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(undefined),
      },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      medicalDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    repository = new UsersRepository(prisma as unknown as PrismaService);
  });

  it('desactivar incrementa sessionVersion, atribuye y revoca en una transacción', async () => {
    const result = await repository.deactivate('user-id', 'actor-id');
    expect(result.status).toBe('updated');
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-id' },
      data: { isActive: false, updatedBy: 'actor-id', sessionVersion: { increment: 1 } },
    }));
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
    expect(tx.medicalDocument.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PROCESSED',
        assignedReviewerId: 'user-id',
      },
      data: {
        assignedReviewerId: null,
        assignedAt: null,
        updatedBy: 'actor-id',
        version: { increment: 1 },
      },
    });
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('crea y conecta el rol solo si conserva la versión previamente autorizada', async () => {
    const roleVersion = new Date('2026-01-01T00:00:00.000Z');

    const result = await repository.createWithRoleGuard(
      {
        email: 'new@clinicview.local',
        username: 'new-user',
        firstName: 'New',
        lastName: 'User',
        fullName: 'New User',
        passwordHash: 'hash',
      },
      'role-id',
      roleVersion,
    );

    expect(result.status).toBe('created');
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userRoles: { create: { role: { connect: { id: 'role-id' } } } },
      }),
    }));
  });

  it('impide desactivar el último administrador activo', async () => {
    tx.user.findUnique.mockResolvedValue({
      ...user,
      userRoles: [{ role: { key: 'ADMINISTRADOR', name: 'Administrador' } }],
    });
    tx.user.count.mockResolvedValue(1);
    const result = await repository.deactivate('user-id', 'actor-id');
    expect(result.status).toBe('last-administrator');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('reactivar mantiene sesiones previas revocadas', async () => {
    tx.user.findUnique.mockResolvedValue({ ...user, isActive: false });
    tx.user.update.mockResolvedValue({ ...user, isActive: true });
    const result = await repository.reactivate('user-id', 'actor-id');
    expect(result?.isActive).toBe(true);
    expect(tx.refreshToken.deleteMany).toHaveBeenCalled();
  });

  it('cambiar contraseña revoca sesiones atómicamente', async () => {
    await repository.updateAndRevokeSessions('user-id', { passwordHash: 'new-hash' });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { passwordHash: 'new-hash', sessionVersion: { increment: 1 } },
    }));
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
  });

  it('reemplazar rol y revocar sesiones ocurre en una transacción', async () => {
    const result = await repository.assignRole(
      'user-id',
      'role-id',
      new Date('2026-01-01T00:00:00.000Z'),
      'actor-id',
    );
    expect(result.status).toBe('updated');
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { updatedBy: 'actor-id', sessionVersion: { increment: 1 } },
    });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
  });

  it('libera revisiones pendientes si el nuevo rol deja al usuario sin elegibilidad', async () => {
    tx.user.findFirst.mockResolvedValue(null);

    await repository.assignRole(
      'user-id',
      'role-id',
      new Date('2026-01-01T00:00:00.000Z'),
      'actor-id',
    );

    expect(tx.medicalDocument.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PROCESSED',
        assignedReviewerId: 'user-id',
      },
      data: {
        assignedReviewerId: null,
        assignedAt: null,
        updatedBy: 'actor-id',
        version: { increment: 1 },
      },
    });
  });

  it('no elimina el rol actual si el rol destino desapareció concurrentemente', async () => {
    tx.role.findUnique.mockResolvedValue(null);

    await expect(repository.assignRole(
      'user-id',
      'missing-role',
      new Date('2026-01-01T00:00:00.000Z'),
      'actor-id',
    )).resolves.toEqual({ status: 'role-not-found' });
    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
  });
});

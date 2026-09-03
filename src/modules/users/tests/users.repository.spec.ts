import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UsersRepository } from '../repositories/users.repository';

describe('UsersRepository session revocation', () => {
  let repository: UsersRepository;
  let tx: {
    user: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    userRole: { deleteMany: jest.Mock; create: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  beforeEach(() => {
    tx = {
      user: {
        update: jest.fn().mockResolvedValue({ id: 'user-id' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'user-id', userRoles: [] }),
      },
      userRole: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(undefined),
      },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    repository = new UsersRepository(prisma as unknown as PrismaService);
  });

  it('desactivar incrementa sessionVersion y borra refresh tokens en la misma transacción', async () => {
    await repository.deactivate('user-id');
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-id' },
        data: { isActive: false, sessionVersion: { increment: 1 } },
      }),
    );
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('cambiar contraseña revoca todas las sesiones atómicamente', async () => {
    await repository.updateAndRevokeSessions('user-id', { passwordHash: 'new-hash' });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { passwordHash: 'new-hash', sessionVersion: { increment: 1 } },
      }),
    );
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
  });

  it('reemplazar rol, incrementar versión y revocar refresh es una sola transacción', async () => {
    await repository.assignRole('user-id', 'role-id');
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'user-id', roleId: 'role-id' },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
  });
});

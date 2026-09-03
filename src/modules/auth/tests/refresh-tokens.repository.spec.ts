import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  RefreshTokensRepository,
  RefreshTokenWrite,
} from '../repositories/refresh-tokens.repository';

const input: RefreshTokenWrite = {
  id: 'c3f08d95-a0a8-46bf-b89a-2c6c6c68dfb5',
  userId: 'f9b3308d-cc74-4f30-823a-75ca624ff69f',
  tokenHash: 'a'.repeat(64),
  sessionVersion: 4,
  rememberMe: true,
  expiresAt: new Date('2026-09-10T12:00:00.000Z'),
};

describe('RefreshTokensRepository', () => {
  let repository: RefreshTokensRepository;
  let prisma: {
    $transaction: jest.Mock;
    refreshToken: { findFirst: jest.Mock };
  };
  let tx: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    refreshToken: {
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ isActive: true, sessionVersion: 4 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({ userId: input.userId }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      refreshToken: {
        findFirst: jest.fn(),
      },
    };
    repository = new RefreshTokensRepository(prisma as unknown as PrismaService);
  });

  it('crea sesión, purga vencidos y actualiza lastLogin en una transacción serializable', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    await expect(repository.createSession(input, now)).resolves.toBe(true);

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: input.userId },
      select: { isActive: true, sessionVersion: true },
    });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: input.userId, expiresAt: { lte: now } },
    });
    expect(tx.refreshToken.create).toHaveBeenCalledWith({ data: input });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: input.userId },
      data: { lastLoginAt: now },
    });
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('no crea sesión para usuario inactivo o de otra versión', async () => {
    tx.user.findUnique.mockResolvedValue({ isActive: false, sessionVersion: 4 });
    await expect(repository.createSession(input, new Date())).resolves.toBe(false);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  it('consume el hash anterior y crea el siguiente atómicamente', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    await expect(repository.rotate('old-hash', input, now)).resolves.toBe(true);
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: {
        tokenHash: 'old-hash',
        userId: input.userId,
        sessionVersion: input.sessionVersion,
        expiresAt: { gt: now },
      },
    });
    expect(tx.refreshToken.create).toHaveBeenCalledWith({ data: input });
  });

  it('rechaza replay sin crear una segunda sesión', async () => {
    tx.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(repository.rotate('consumed-hash', input, new Date())).resolves.toBe(false);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  it('convierte un conflicto serializable concurrente en rechazo seguro', async () => {
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(repository.rotate('racing-hash', input, new Date())).resolves.toBe(false);
  });

  it('busca solo hashes no vencidos y elimina de forma idempotente', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await expect(repository.findActiveByHash(input.tokenHash, now)).resolves.toBeNull();
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: { tokenHash: input.tokenHash, expiresAt: { gt: now } },
      select: {
        userId: true,
        sessionVersion: true,
        rememberMe: true,
        expiresAt: true,
      },
    });

    await expect(repository.deleteByHash(input.tokenHash)).resolves.toBe(input.userId);
    expect(tx.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: input.tokenHash },
      select: { userId: true },
    });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: input.tokenHash, userId: input.userId },
    });
  });
});

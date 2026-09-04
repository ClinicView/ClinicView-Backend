import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface StoredRefreshToken {
  userId: string;
  sessionVersion: number;
  rememberMe: boolean;
  expiresAt: Date;
}

export interface RefreshTokenWrite {
  id: string;
  userId: string;
  tokenHash: string;
  sessionVersion: number;
  rememberMe: boolean;
  expiresAt: Date;
}

export interface RefreshTokenActor {
  userId: string;
  username: string;
}

function isSerializationConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034',
  );
}

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: RefreshTokenWrite, now: Date): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: input.userId },
            select: { isActive: true, sessionVersion: true },
          });
          if (!user?.isActive || user.sessionVersion !== input.sessionVersion) return false;

          await tx.refreshToken.deleteMany({
            where: { userId: input.userId, expiresAt: { lte: now } },
          });
          await tx.refreshToken.create({ data: input });
          await tx.user.update({
            where: { id: input.userId },
            data: { lastLoginAt: now },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationConflict(error)) return false;
      throw error;
    }
  }

  async findActiveByHash(tokenHash: string, now: Date): Promise<StoredRefreshToken | null> {
    return this.prisma.refreshToken.findFirst({
      where: { tokenHash, expiresAt: { gt: now } },
      select: {
        userId: true,
        sessionVersion: true,
        rememberMe: true,
        expiresAt: true,
      },
    });
  }

  async rotate(oldTokenHash: string, next: RefreshTokenWrite, now: Date): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: next.userId },
            select: { isActive: true, sessionVersion: true },
          });
          if (!user?.isActive || user.sessionVersion !== next.sessionVersion) return false;

          const consumed = await tx.refreshToken.deleteMany({
            where: {
              tokenHash: oldTokenHash,
              userId: next.userId,
              sessionVersion: next.sessionVersion,
              expiresAt: { gt: now },
            },
          });
          if (consumed.count !== 1) return false;

          await tx.refreshToken.create({ data: next });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationConflict(error)) return false;
      throw error;
    }
  }

  async deleteByHash(tokenHash: string): Promise<RefreshTokenActor | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          userId: true,
          user: { select: { username: true } },
        },
      });
      if (!existing) return null;
      const deleted = await tx.refreshToken.deleteMany({
        where: { tokenHash, userId: existing.userId },
      });
      return deleted.count === 1
        ? { userId: existing.userId, username: existing.user.username }
        : null;
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  async store(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  async findByHash(tokenHash: string): Promise<{ userId: string } | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
  }

  async rotate(oldHash: string, userId: string, newHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { tokenHash: oldHash } }),
      this.prisma.refreshToken.create({ data: { userId, tokenHash: newHash, expiresAt } }),
    ]);
  }

  async deleteByHash(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }

  async deleteExpiredForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  }
}

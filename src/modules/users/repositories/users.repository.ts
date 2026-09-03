import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const withRoles = {
  include: {
    userRoles: { include: { role: { select: { key: true, name: true } } } },
  },
} as const;

export type UserWithRoles = Prisma.UserGetPayload<typeof withRoles>;

const userWithPermissionsArgs = {
  include: {
    userRoles: {
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: { select: { key: true } } },
            },
          },
        },
      },
    },
  },
} as const;

export type UserWithPermissions = Prisma.UserGetPayload<typeof userWithPermissionsArgs>;

/**
 * UsersRepository — acceso a datos de usuarios a través de PrismaService.
 * Solo métodos de dominio; sin lógica de negocio.
 * PrismaService se inyecta directamente porque PrismaModule es @Global().
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.UserCreateInput): Promise<UserWithRoles> {
    return this.prisma.user.create({ data, ...withRoles });
  }

  async findMany(): Promise<UserWithRoles[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' }, ...withRoles });
  }

  /** Búsqueda liviana de profesionales activos para selectores clínicos. */
  async searchActiveProfessionals(
    query: string,
    limit = 8,
  ): Promise<Array<Pick<User, 'id' | 'fullName' | 'profession'>>> {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(query && {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { profession: { contains: query, mode: 'insensitive' } },
          ],
        }),
      },
      select: { id: true, fullName: true, profession: true },
      orderBy: { fullName: 'asc' },
      take: limit,
    });
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { id }, ...withRoles });
  }

  /** Para validación de credenciales en auth — devuelve el hash. Usar con cuidado. */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findByDocumentNumber(documentNumber: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { documentNumber } });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<UserWithRoles> {
    return this.prisma.user.update({ where: { id }, data, ...withRoles });
  }

  async updateAndRevokeSessions(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<UserWithRoles> {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data: { ...data, sessionVersion: { increment: 1 } },
          ...withRoles,
        });
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        return user;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deactivate(id: string): Promise<UserWithRoles> {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data: { isActive: false, sessionVersion: { increment: 1 } },
          ...withRoles,
        });
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        return user;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async assignRole(userId: string, roleId: string): Promise<UserWithRoles> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.create({ data: { userId, roleId } });
        await tx.user.update({
          where: { id: userId },
          data: { sessionVersion: { increment: 1 } },
        });
        await tx.refreshToken.deleteMany({ where: { userId } });
        return tx.user.findUniqueOrThrow({ where: { id: userId }, ...withRoles });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findRoleByKey(key: string) {
    return this.prisma.role.findUnique({ where: { key } });
  }

  /** Para uso exclusivo de auth — devuelve usuario con árbol de permisos. */
  async findByEmailWithPermissions(email: string): Promise<UserWithPermissions | null> {
    return this.prisma.user.findUnique({
      where: { email },
      ...userWithPermissionsArgs,
    });
  }

  async findByIdWithPermissions(id: string): Promise<UserWithPermissions | null> {
    return this.prisma.user.findUnique({
      where: { id },
      ...userWithPermissionsArgs,
    });
  }

  /** Para uso exclusivo de auth — registra el último acceso. */
  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}

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

  async deactivate(id: string): Promise<UserWithRoles> {
    return this.prisma.user.update({ where: { id }, data: { isActive: false }, ...withRoles });
  }

  async assignRole(userId: string, roleId: string): Promise<UserWithRoles> {
    await this.prisma.userRole.deleteMany({ where: { userId } });
    await this.prisma.userRole.create({ data: { userId, roleId } });
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, ...withRoles });
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

  /** Para uso exclusivo de auth — registra el último acceso. */
  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { DocumentStatus, Prisma, User } from '@prisma/client';
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

const roleWithPermissionKeysArgs = {
  include: {
    rolePermissions: {
      include: { permission: { select: { key: true } } },
    },
  },
} as const;

export type RoleWithPermissionKeys = Prisma.RoleGetPayload<
  typeof roleWithPermissionKeysArgs
>;

export type GuardedUserMutationResult =
  | { status: 'updated'; user: UserWithRoles }
  | { status: 'not-found' }
  | { status: 'last-administrator' };

export type GuardedRoleAssignmentResult =
  | GuardedUserMutationResult
  | { status: 'role-not-found' }
  | { status: 'stale-role' };

export type GuardedUserCreateResult =
  | { status: 'created'; user: UserWithRoles }
  | { status: 'role-not-found' }
  | { status: 'stale-role' };

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

  async createWithRoleGuard(
    data: Prisma.UserCreateInput,
    roleId: string,
    expectedRoleUpdatedAt: Date,
  ): Promise<GuardedUserCreateResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const role = await tx.role.findUnique({
          where: { id: roleId },
          select: { updatedAt: true },
        });
        if (!role) return { status: 'role-not-found' } as const;
        if (role.updatedAt.getTime() !== expectedRoleUpdatedAt.getTime()) {
          return { status: 'stale-role' } as const;
        }
        const user = await tx.user.create({
          data: {
            ...data,
            userRoles: { create: { role: { connect: { id: roleId } } } },
          },
          ...withRoles,
        });
        return { status: 'created', user } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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

  async deactivate(id: string, updatedBy: string): Promise<GuardedUserMutationResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({ where: { id }, ...withRoles });
        if (!existing) return { status: 'not-found' } as const;
        if (!existing.isActive) return { status: 'updated', user: existing } as const;

        const isAdministrator = existing.userRoles.some(
          ({ role }) => role.key === 'ADMINISTRADOR',
        );
        if (isAdministrator) {
          const activeAdministrators = await tx.user.count({
            where: {
              isActive: true,
              userRoles: { some: { role: { key: 'ADMINISTRADOR' } } },
            },
          });
          if (activeAdministrators <= 1) return { status: 'last-administrator' } as const;
        }

        const user = await tx.user.update({
          where: { id },
          data: { isActive: false, updatedBy, sessionVersion: { increment: 1 } },
          ...withRoles,
        });
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        await tx.medicalDocument.updateMany({
          where: {
            status: DocumentStatus.PROCESSED,
            assignedReviewerId: id,
          },
          data: {
            assignedReviewerId: null,
            assignedAt: null,
            updatedBy,
            version: { increment: 1 },
          },
        });
        return { status: 'updated', user } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reactivate(id: string, updatedBy: string): Promise<UserWithRoles | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({ where: { id }, ...withRoles });
        if (!existing) return null;
        if (existing.isActive) return existing;

        const user = await tx.user.update({
          where: { id },
          data: { isActive: true, updatedBy, sessionVersion: { increment: 1 } },
          ...withRoles,
        });
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        return user;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async assignRole(
    userId: string,
    roleId: string,
    expectedRoleUpdatedAt: Date,
    updatedBy: string,
  ): Promise<GuardedRoleAssignmentResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({ where: { id: userId }, ...withRoles });
        if (!existing) return { status: 'not-found' } as const;
        const nextRole = await tx.role.findUnique({
          where: { id: roleId },
          select: { key: true, updatedAt: true },
        });
        if (!nextRole) return { status: 'role-not-found' } as const;
        if (nextRole.updatedAt.getTime() !== expectedRoleUpdatedAt.getTime()) {
          return { status: 'stale-role' } as const;
        }

        const removesAdministrator =
          existing.isActive &&
          existing.userRoles.some(({ role }) => role.key === 'ADMINISTRADOR') &&
          nextRole.key !== 'ADMINISTRADOR';
        if (removesAdministrator) {
          const activeAdministrators = await tx.user.count({
            where: {
              isActive: true,
              userRoles: { some: { role: { key: 'ADMINISTRADOR' } } },
            },
          });
          if (activeAdministrators <= 1) return { status: 'last-administrator' } as const;
        }

        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.create({ data: { userId, roleId } });
        await tx.user.update({
          where: { id: userId },
          data: { updatedBy, sessionVersion: { increment: 1 } },
        });
        await tx.refreshToken.deleteMany({ where: { userId } });

        const eligibleReviewer = await tx.user.findFirst({
          where: {
            id: userId,
            isActive: true,
            AND: [
              {
                userRoles: {
                  some: {
                    role: {
                      rolePermissions: {
                        some: { permission: { key: 'review.read' } },
                      },
                    },
                  },
                },
              },
              {
                userRoles: {
                  some: {
                    role: {
                      rolePermissions: {
                        some: { permission: { key: 'documents.validate' } },
                      },
                    },
                  },
                },
              },
              {
                userRoles: {
                  some: {
                    role: {
                      rolePermissions: {
                        some: { permission: { key: 'documents.read' } },
                      },
                    },
                  },
                },
              },
            ],
          },
          select: { id: true },
        });
        if (!eligibleReviewer) {
          await tx.medicalDocument.updateMany({
            where: {
              status: DocumentStatus.PROCESSED,
              assignedReviewerId: userId,
            },
            data: {
              assignedReviewerId: null,
              assignedAt: null,
              updatedBy,
              version: { increment: 1 },
            },
          });
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, ...withRoles });
        return { status: 'updated', user } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findRoleByKey(key: string) {
    return this.prisma.role.findUnique({ where: { key } });
  }

  async findRoleByKeyWithPermissions(key: string): Promise<RoleWithPermissionKeys | null> {
    return this.prisma.role.findUnique({
      where: { key },
      ...roleWithPermissionKeysArgs,
    });
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

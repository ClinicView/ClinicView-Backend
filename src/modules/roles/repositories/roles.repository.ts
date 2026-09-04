import { Injectable } from '@nestjs/common';
import { DocumentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const roleWithPermissionsArgs = {
  include: {
    rolePermissions: {
      include: { permission: true },
      orderBy: { permission: { key: 'asc' } } as Prisma.RolePermissionOrderByWithRelationInput,
    },
    _count: { select: { userRoles: true } },
  },
} as const;

export type RoleWithPermissions = Prisma.RoleGetPayload<typeof roleWithPermissionsArgs>;

export type UpdateRolePermissionsResult =
  | { status: 'updated'; role: RoleWithPermissions }
  | { status: 'not-found' }
  | { status: 'stale' }
  | { status: 'invalid-permissions'; keys: string[] };

export type UpdateRoleResult =
  | { status: 'updated'; role: RoleWithPermissions }
  | { status: 'not-found' }
  | { status: 'stale' };

export type DeleteRoleResult =
  | { status: 'deleted' }
  | { status: 'not-found' }
  | { status: 'stale' }
  | { status: 'in-use'; userCount: number };

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(): Promise<RoleWithPermissions[]> {
    return this.prisma.role.findMany({
      ...roleWithPermissionsArgs,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string): Promise<RoleWithPermissions | null> {
    return this.prisma.role.findUnique({
      where: { id },
      ...roleWithPermissionsArgs,
    });
  }

  async findByKey(key: string): Promise<RoleWithPermissions | null> {
    return this.prisma.role.findUnique({ where: { key }, ...roleWithPermissionsArgs });
  }

  async findPermissions() {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
  }

  async create(data: Prisma.RoleCreateInput): Promise<RoleWithPermissions> {
    return this.prisma.role.create({ data, ...roleWithPermissionsArgs });
  }

  async update(
    id: string,
    data: Prisma.RoleUpdateManyMutationInput,
    expectedUpdatedAt: Date,
  ): Promise<UpdateRoleResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.role.updateMany({
          where: { id, updatedAt: expectedUpdatedAt },
          data: { ...data, updatedAt: new Date() },
        });
        if (updated.count === 0) {
          const exists = await tx.role.count({ where: { id } });
          return { status: exists ? 'stale' : 'not-found' } as const;
        }
        const role = await tx.role.findUniqueOrThrow({
          where: { id },
          ...roleWithPermissionsArgs,
        });
        return { status: 'updated', role } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async replacePermissions(
    roleId: string,
    permissionKeys: string[],
    expectedUpdatedAt: Date,
    actorId: string,
  ): Promise<UpdateRolePermissionsResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const role = await tx.role.findUnique({ where: { id: roleId } });
        if (!role) return { status: 'not-found' } as const;
        if (role.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          return { status: 'stale' } as const;
        }

        const permissions = await tx.permission.findMany({
          where: { key: { in: permissionKeys } },
          select: { id: true, key: true },
        });
        const foundKeys = new Set(permissions.map(({ key }) => key));
        const invalidKeys = permissionKeys.filter((key) => !foundKeys.has(key));
        if (invalidKeys.length > 0) {
          return { status: 'invalid-permissions', keys: invalidKeys } as const;
        }

        const members = await tx.userRole.findMany({
          where: { roleId },
          select: { userId: true },
        });
        const memberIds = members.map(({ userId }) => userId);

        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map(({ id }) => ({ roleId, permissionId: id })),
          });
        }
        if (memberIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: memberIds } },
            data: { sessionVersion: { increment: 1 } },
          });
          await tx.refreshToken.deleteMany({ where: { userId: { in: memberIds } } });

          const eligibleReviewers = await tx.user.findMany({
            where: {
              id: { in: memberIds },
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
          const eligibleReviewerIds = new Set(
            eligibleReviewers.map(({ id }) => id),
          );
          const ineligibleReviewerIds = memberIds.filter(
            (id) => !eligibleReviewerIds.has(id),
          );
          if (ineligibleReviewerIds.length > 0) {
            await tx.medicalDocument.updateMany({
              where: {
                status: DocumentStatus.PROCESSED,
                assignedReviewerId: { in: ineligibleReviewerIds },
              },
              data: {
                assignedReviewerId: null,
                assignedAt: null,
                updatedBy: actorId,
                version: { increment: 1 },
              },
            });
          }
        }

        await tx.role.update({ where: { id: roleId }, data: { updatedAt: new Date() } });

        const updated = await tx.role.findUniqueOrThrow({
          where: { id: roleId },
          ...roleWithPermissionsArgs,
        });
        return { status: 'updated', role: updated } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async delete(id: string, expectedUpdatedAt: Date): Promise<DeleteRoleResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const role = await tx.role.findUnique({
          where: { id },
          include: { _count: { select: { userRoles: true } } },
        });
        if (!role) return { status: 'not-found' } as const;
        if (role.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          return { status: 'stale' } as const;
        }
        if (role._count.userRoles > 0) {
          return { status: 'in-use', userCount: role._count.userRoles } as const;
        }
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.role.delete({ where: { id } });
        return { status: 'deleted' } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

const roleWithPermissionsArgs = {
  include: {
    rolePermissions: {
      include: { permission: true },
      orderBy: { permission: { key: 'asc' } } as Prisma.RolePermissionOrderByWithRelationInput,
    },
  },
} as const;

export type RoleWithPermissions = Prisma.RoleGetPayload<typeof roleWithPermissionsArgs>;

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
}

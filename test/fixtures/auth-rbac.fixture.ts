import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

export const E2E_SENTINELS = {
  email: 'audit-pii-sentinel@clinicview.invalid',
  password: 'E2E-Password-Sentinel-7042!',
  badPassword: 'E2E-Bad-Password-Sentinel-5821!',
  query: 'E2E_QUERY_PII_SENTINEL_91A7',
  userAgent: 'ClinicView-E2E-UA-SENTINEL-91A7',
} as const;

const PERMISSIONS = {
  usersRead: 'users.read',
  usersManage: 'admin.users.manage',
  patientsRead: 'patients.read',
  documentsRead: 'documents.read',
  auditRead: 'admin.audit.read',
} as const;

const ROLE_KEYS = {
  admin: 'E2E_ADMIN',
  dashboard: 'E2E_DASHBOARD',
  limited: 'E2E_LIMITED',
} as const;

export interface E2eIdentity {
  id: string;
  email: string;
  username: string;
  password: string;
}

export interface AuthRbacFixture {
  admin: E2eIdentity;
  dashboard: E2eIdentity;
  limited: E2eIdentity;
  limitedRoleKey: string;
}

export async function createAuthRbacFixture(prisma: PrismaClient): Promise<AuthRbacFixture> {
  const permissionKeys = Object.values(PERMISSIONS);
  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.create({
        data: { key, description: `Permiso sintético E2E: ${key}` },
      }),
    ),
  );
  const permissionId = new Map(permissions.map((permission) => [permission.key, permission.id]));

  async function createRole(key: string, keys: string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key, name: `Rol sintético ${key}`, description: 'Uso exclusivo de E2E.' },
    });
    await prisma.rolePermission.createMany({
      data: keys.map((permissionKey) => ({
        roleId: role.id,
        permissionId: permissionId.get(permissionKey) as string,
      })),
    });
    return role.id;
  }

  const adminRoleId = await createRole(ROLE_KEYS.admin, permissionKeys);
  const dashboardRoleId = await createRole(ROLE_KEYS.dashboard, [
    PERMISSIONS.patientsRead,
    PERMISSIONS.documentsRead,
  ]);
  const limitedRoleId = await createRole(ROLE_KEYS.limited, [PERMISSIONS.patientsRead]);

  async function createUser(
    roleId: string,
    suffix: string,
    email: string,
    password: string,
  ): Promise<E2eIdentity> {
    const user = await prisma.user.create({
      data: {
        email,
        username: `e2e_${suffix}`,
        firstName: 'Persona',
        lastName: `Sintética ${suffix}`,
        fullName: `Persona Sintética ${suffix}`,
        profession: 'Profesional E2E',
        passwordHash: await bcrypt.hash(password, 4),
        userRoles: { create: { roleId } },
      },
    });
    return { id: user.id, email, username: user.username, password };
  }

  return {
    admin: await createUser(adminRoleId, 'admin', E2E_SENTINELS.email, E2E_SENTINELS.password),
    dashboard: await createUser(
      dashboardRoleId,
      'dashboard',
      'dashboard.e2e@clinicview.invalid',
      'E2E-Dashboard-Password-7042!',
    ),
    limited: await createUser(
      limitedRoleId,
      'limited',
      'limited.e2e@clinicview.invalid',
      'E2E-Limited-Password-7042!',
    ),
    limitedRoleKey: ROLE_KEYS.limited,
  };
}

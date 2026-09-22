import type { PrismaClient } from '@prisma/client';

export interface SeedRole {
  key: string;
  name: string;
  description: string;
}

export interface SeedPermission {
  key: string;
  description: string;
}

type SeedClient = Pick<PrismaClient, 'permission' | 'role' | 'user'>;

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** Importing this module never opens a database connection or reads the environment. */
export async function seedAccessCatalog(
  client: SeedClient,
  roles: readonly SeedRole[],
  permissions: readonly SeedPermission[],
  defaults: Readonly<Record<string, readonly string[]>>,
): Promise<{ permissionsEnsured: number; rolesCreated: number; rolesPreserved: number; grantsCreated: number }> {
  const knownKeys = new Set(permissions.map((permission) => permission.key));
  for (const role of roles) {
    if ((defaults[role.key] ?? []).some((key) => !knownKeys.has(key))) {
      throw new Error('Los permisos iniciales contienen una capacidad no declarada.');
    }
  }

  for (const permission of permissions) {
    // An empty update preserves an existing administrator-maintained description.
    await client.permission.upsert({
      where: { key: permission.key },
      update: {},
      create: permission,
    });
  }

  let rolesCreated = 0;
  let rolesPreserved = 0;
  let grantsCreated = 0;
  for (const role of roles) {
    const where = { key: role.key };
    if (await client.role.findUnique({ where, select: { id: true } })) {
      rolesPreserved++;
      continue;
    }
    const permissionKeys = [...new Set(defaults[role.key] ?? [])];
    try {
      // One nested write: a new role and ALL of its initial grants commit or roll
      // back together. There is deliberately no rolePermission upsert afterwards.
      await client.role.create({
        data: {
          ...role,
          rolePermissions: {
            create: permissionKeys.map((key) => ({ permission: { connect: { key } } })),
          },
        },
        select: { id: true },
      });
      rolesCreated++;
      grantsCreated += permissionKeys.length;
    } catch (error) {
      // A concurrent creator owns the winning role. Never add our defaults to it.
      if (!isUniqueConflict(error) || !(await client.role.findUnique({ where, select: { id: true } }))) throw error;
      rolesPreserved++;
    }
  }
  return { permissionsEnsured: permissions.length, rolesCreated, rolesPreserved, grantsCreated };
}

export interface InitialAdministratorInput {
  email: string;
  password: string;
  username?: string;
  fullName?: string;
}

export class BootstrapIdentityConflictError extends Error {
  readonly code = 'BOOTSTRAP_IDENTITY_CONFLICT';
  constructor() {
    super('La identidad solicitada para el administrador inicial no está disponible. No se modificó ninguna cuenta existente.');
  }
}

/** Create-only bootstrap: never a password reset, role repair or privilege grant. */
export async function seedInitialAdministrator(
  client: SeedClient,
  input: InitialAdministratorInput,
  hashPassword: (password: string) => Promise<string>,
): Promise<'created' | 'preserved'> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) throw new Error('El administrador inicial necesita correo y contraseña.');
  const whereEmail = { email: { equals: email, mode: 'insensitive' as const } };
  if (await client.user.findFirst({ where: whereEmail, select: { id: true } })) return 'preserved';

  const username = input.username?.trim().toLowerCase()
    || email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase()
    || 'admin';
  if (await client.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true },
  })) throw new BootstrapIdentityConflictError();

  const fullName = input.fullName?.trim() || 'Administrador del Sistema';
  const [firstName, ...lastNameParts] = fullName.split(/\s+/);
  const passwordHash = await hashPassword(input.password);
  try {
    // The account cannot survive without its initial role if this write fails.
    // Conversely, an existing account never receives a standalone userRole write.
    await client.user.create({
      data: {
        email,
        username,
        firstName,
        lastName: lastNameParts.join(' ') || 'Sistema',
        fullName,
        profession: 'Administrador del sistema',
        passwordHash,
        userRoles: { create: { role: { connect: { key: 'ADMINISTRADOR' } } } },
      },
      select: { id: true },
    });
    return 'created';
  } catch (error) {
    // Unique email races may only preserve the other writer's identity, never
    // repair its role or overwrite its password. A different username conflict fails.
    if (!isUniqueConflict(error)) throw error;
    if (await client.user.findFirst({ where: whereEmail, select: { id: true } })) return 'preserved';
    throw new BootstrapIdentityConflictError();
  }
}

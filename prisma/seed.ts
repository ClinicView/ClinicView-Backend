/**
 * Seed idempotente — Plataforma Clínica Hospitalaria
 * Siembra roles base, capacidades (permisos) y, opcionalmente, el usuario administrador inicial.
 *
 * Reglas:
 * - Idempotente: re-ejecutar no duplica ni pierde datos (upsert).
 * - Sin datos clínicos reales ni PII/PHI.
 * - Fuente de verdad de roles y permisos: docs/database/README.md §2 + modules/README.md.
 * - El admin inicial se crea SOLO si ADMIN_EMAIL y ADMIN_PASSWORD están en el entorno.
 *
 * Ejecutar: npm run db:seed  (o: npx prisma db seed)
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Roles base ───────────────────────────────────────────────────────────────
// Claves en SCREAMING_SNAKE_CASE; son la fuente de verdad del RBAC.
// Preparados para añadir DIGITALIZADOR y otros sin cambios estructurales.

const ROLES = [
  {
    key: 'ADMINISTRADOR',
    name: 'Administrador',
    description: 'Acceso completo al sistema. Gestiona usuarios, roles y configuración.',
  },
  {
    key: 'MEDICO',
    name: 'Médico',
    description:
      'Registro y consulta de historias clínicas. Digitalización y revisión de documentos clínicos.',
  },
  {
    key: 'FARMACEUTICO',
    name: 'Farmacéutico',
    description: 'Consulta de historias clínicas con foco en medicación y prescripciones.',
  },
  {
    key: 'LABORATORISTA',
    name: 'Laboratorista',
    description: 'Carga y consulta de resultados de laboratorio. Validación de entidades clínicas.',
  },
  {
    key: 'TERAPEUTA',
    name: 'Terapeuta',
    description: 'Registro y consulta de atenciones terapéuticas y evoluciones.',
  },
] as const;

// ─── Permisos / Capacidades ───────────────────────────────────────────────────
// Formato: <dominio>.<acción> (kebab para dominios compuestos).
// El código verifica PERMISOS, no roles hardcodeados (RBAC por capacidad).

const PERMISSIONS = [
  // Usuarios (módulo users)
  { key: 'users.read', description: 'Consultar listado y perfil de usuarios del sistema.' },
  { key: 'users.create', description: 'Crear nuevos usuarios del sistema.' },
  { key: 'users.update', description: 'Editar datos de usuarios existentes.' },
  { key: 'users.deactivate', description: 'Desactivar cuentas de usuario.' },

  // Roles y permisos (módulo roles)
  { key: 'roles.read', description: 'Consultar roles y permisos definidos.' },
  { key: 'roles.manage', description: 'Crear, editar y asignar roles y permisos.' },

  // Pacientes (módulo patients)
  { key: 'patients.read', description: 'Consultar datos demográficos de pacientes.' },
  { key: 'patients.create', description: 'Registrar nuevos pacientes en el sistema.' },
  { key: 'patients.update', description: 'Actualizar datos de pacientes existentes.' },

  // Historias clínicas (módulo clinical-records)
  { key: 'records.read', description: 'Consultar historias clínicas estructuradas.' },
  {
    key: 'records.create',
    description: 'Crear registros clínicos (manual o por digitalización).',
  },
  {
    key: 'records.correct',
    description: 'Emitir correcciones sobre registros clínicos existentes.',
  },
  { key: 'records.void', description: 'Anular registros clínicos (borrado lógico).' },

  // Documentos médicos (módulo medical-documents)
  { key: 'documents.upload', description: 'Subir documentos clínicos para digitalización.' },
  { key: 'documents.read', description: 'Consultar documentos médicos y su estado.' },
  {
    key: 'documents.validate',
    description: 'Validar documentos digitalizados tras revisión humana.',
  },
  { key: 'documents.reject', description: 'Rechazar documentos que no superan la revisión.' },

  // Entidades clínicas (módulo clinical-entities)
  { key: 'entities.read', description: 'Consultar entidades clínicas extraídas.' },
  {
    key: 'entities.validate',
    description: 'Validar y normalizar entidades clínicas (diagnósticos, medicamentos, etc.).',
  },

  // Revisión de documentos (módulo review)
  { key: 'review.read', description: 'Acceder a la cola de revisión de documentos.' },
  { key: 'review.assign', description: 'Asignarse o asignar documentos para revisión.' },

  // Administración y plataforma (módulo admin + audit)
  { key: 'admin.users.manage', description: 'Gestión administrativa completa de usuarios.' },
  { key: 'admin.roles.manage', description: 'Gestión administrativa de roles y permisos.' },
  { key: 'admin.metrics.read', description: 'Consultar métricas técnicas y estadísticas del sistema.' },
  { key: 'admin.audit.read', description: 'Consultar el log de auditoría del sistema.' },
] as const;

type PermissionKey = (typeof PERMISSIONS)[number]['key'];

// ─── Asignación de permisos a roles ───────────────────────────────────────────

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as PermissionKey[];

const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  ADMINISTRADOR: ALL_PERMISSION_KEYS,

  MEDICO: [
    'patients.read',
    'patients.create',
    'patients.update',
    'records.read',
    'records.create',
    'records.correct',
    'records.void',
    'documents.upload',
    'documents.read',
    'documents.validate',
    'documents.reject',
    'entities.read',
    'entities.validate',
    'review.read',
    'review.assign',
  ],

  FARMACEUTICO: ['patients.read', 'records.read', 'documents.read', 'entities.read'],

  LABORATORISTA: [
    'patients.read',
    'records.read',
    'records.create',
    'documents.upload',
    'documents.read',
    'entities.read',
    'entities.validate',
    'review.read',
  ],

  TERAPEUTA: [
    'patients.read',
    'records.read',
    'records.create',
    'records.correct',
    'records.void',
    'documents.upload',
    'documents.read',
    'entities.read',
    'review.read',
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 Iniciando seed de roles y permisos...\n');

  // 1. Permisos
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { key: permission.key, description: permission.description },
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permisos sembrados`);

  // 2. Roles
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: { key: role.key, name: role.name, description: role.description },
    });
  }
  console.log(`  ✓ ${ROLES.length} roles sembrados`);

  // 3. Asignaciones rol → permisos (idempotente por clave compuesta)
  let assignCount = 0;
  for (const [roleKey, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });

    for (const permKey of permKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      assignCount++;
    }
  }
  console.log(`  ✓ ${assignCount} asignaciones de permisos sembradas`);

  // Resumen
  console.log('\n📋 Resumen:');
  for (const roleKey of Object.keys(ROLE_PERMISSIONS)) {
    const count = ROLE_PERMISSIONS[roleKey].length;
    console.log(`   ${roleKey}: ${count} permisos`);
  }

  console.log('\n✅ Seed de roles y permisos completado.');

  // 4. Admin inicial (opcional — requiere ADMIN_EMAIL + ADMIN_PASSWORD en el entorno)
  await seedAdminUser();
}

async function seedAdminUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME?.trim() ?? 'Administrador del Sistema';
  const [firstName, ...lastNameParts] = fullName.split(' ');
  const username =
    process.env.ADMIN_USERNAME?.trim() ??
    email?.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase() ??
    'admin';

  if (!email || !password) {
    console.log('\n⚠️  ADMIN_EMAIL o ADMIN_PASSWORD no definidos.');
    console.log('   Para crear el admin inicial, defínelos en .env y vuelve a ejecutar npm run db:seed.');
    return;
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMINISTRADOR' } });
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},  // Si ya existe, no sobreescribir — el admin gestiona su propia contraseña.
    create: {
      email,
      username,
      firstName: firstName || 'Administrador',
      lastName: lastNameParts.join(' ') || 'Sistema',
      fullName,
      profession: 'Administrador del sistema',
      passwordHash,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  // No loguear contraseña ni hash.
  console.log(`\n✅ Admin inicial listo — email: ${email}, rol: ADMINISTRADOR`);
}

main()
  .catch((error: unknown) => {
    console.error('\n❌ Error en seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

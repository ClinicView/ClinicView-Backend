/**
 * Seed idempotente — Plataforma Clínica Hospitalaria
 * Siembra roles base, capacidades (permisos) y, opcionalmente, el usuario administrador inicial.
 *
 * Reglas:
 * - Create-only: re-ejecutar conserva nombres, permisos y cuentas administrados.
 * - Los permisos predeterminados se asignan SOLO al crear un rol, de forma atómica.
 * - Sin datos clínicos reales ni PII/PHI.
 * - Fuente de verdad de roles y permisos: docs/database/README.md §2 + modules/README.md.
 * - El admin inicial se crea SOLO si ADMIN_EMAIL y ADMIN_PASSWORD están en el entorno.
 *
 * Ejecutar: npm run db:seed  (o: npx prisma db seed)
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { seedAccessCatalog, seedInitialAdministrator } from './seed-access';

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
  { key: 'catalogs.manage', description: 'Administrar servicios y especialidades institucionales.' },
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
  { key: 'records.confirm', description: 'Confirmar y cerrar una versión clínica revisada.' },

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
    'records.confirm',
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

  FARMACEUTICO: ['patients.read', 'records.read', 'records.confirm', 'documents.read', 'entities.read'],

  LABORATORISTA: [
    'records.confirm',
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
    'records.confirm',
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
  const result = await seedAccessCatalog(prisma, ROLES, PERMISSIONS, ROLE_PERMISSIONS);
  console.log(`  ✓ ${result.permissionsEnsured} capacidades comprobadas sin reemplazar descripciones existentes`);
  console.log(`  ✓ ${result.rolesCreated} roles creados; ${result.rolesPreserved} roles existentes conservados`);
  console.log(`  ✓ ${result.grantsCreated} permisos iniciales asignados solo a roles nuevos`);
  console.log('\n✅ Catálogo inicial preparado; las decisiones administrativas previas se conservan.');

  // 4. Admin inicial (opcional — requiere ADMIN_EMAIL + ADMIN_PASSWORD en el entorno)
  await seedAdminUser();
}

async function seedAdminUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('\n⚠️  ADMIN_EMAIL o ADMIN_PASSWORD no definidos.');
    console.log('   Para crear el admin inicial, defínelos en .env y vuelve a ejecutar npm run db:seed.');
    return;
  }

  const result = await seedInitialAdministrator(prisma, {
    email,
    password,
    fullName: process.env.ADMIN_FULL_NAME,
    username: process.env.ADMIN_USERNAME,
  }, (value) => bcrypt.hash(value, 12));
  // No imprimir correo, contraseña ni hash. Un email existente NO es un nuevo admin.
  console.log(result === 'created'
    ? '\n✅ Cuenta administrativa inicial creada con su rol.'
    : '\nℹ️  La cuenta indicada ya existía; se conservaron su estado, contraseña y roles sin cambios.');
}

main()
  .catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
      && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code : 'SEED_FAILED';
    console.error(`\n❌ No se pudo completar el seed (${code}). Se omiten detalles que podrían contener datos de cuentas.`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

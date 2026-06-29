/**
 * PermissionKey — capacidades del sistema RBAC.
 * Fuente de verdad: deben coincidir con los `key` sembrados en prisma/seed.ts.
 * Los guards de acceso (core/rbac) y los decoradores de política usan estos valores.
 * El frontend los recibe derivados del OpenAPI — no los escribas a mano allí.
 */
export enum PermissionKey {
  // Usuarios
  USERS_READ = 'users.read',
  USERS_CREATE = 'users.create',
  USERS_UPDATE = 'users.update',
  USERS_DEACTIVATE = 'users.deactivate',

  // Roles
  ROLES_READ = 'roles.read',
  ROLES_MANAGE = 'roles.manage',

  // Pacientes
  PATIENTS_READ = 'patients.read',
  PATIENTS_CREATE = 'patients.create',
  PATIENTS_UPDATE = 'patients.update',

  // Historias clínicas
  RECORDS_READ = 'records.read',
  RECORDS_CREATE = 'records.create',
  RECORDS_CORRECT = 'records.correct',
  RECORDS_VOID = 'records.void',

  // Documentos médicos
  DOCUMENTS_UPLOAD = 'documents.upload',
  DOCUMENTS_READ = 'documents.read',
  DOCUMENTS_VALIDATE = 'documents.validate',
  DOCUMENTS_REJECT = 'documents.reject',

  // Entidades clínicas
  ENTITIES_READ = 'entities.read',
  ENTITIES_VALIDATE = 'entities.validate',

  // Revisión
  REVIEW_READ = 'review.read',
  REVIEW_ASSIGN = 'review.assign',

  // Administración
  ADMIN_USERS_MANAGE = 'admin.users.manage',
  ADMIN_ROLES_MANAGE = 'admin.roles.manage',
  ADMIN_METRICS_READ = 'admin.metrics.read',
  ADMIN_AUDIT_READ = 'admin.audit.read',
}

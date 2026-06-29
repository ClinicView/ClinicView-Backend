/**
 * RoleKey — claves canónicas de roles del sistema.
 * Fuente de verdad: deben coincidir con los `key` sembrados en prisma/seed.ts.
 * El código verifica PERMISOS (PermissionKey), no roles directamente — usar esto
 * solo para seed, guards de administración y comparaciones puntuales.
 */
export enum RoleKey {
  ADMINISTRADOR = 'ADMINISTRADOR',
  MEDICO = 'MEDICO',
  FARMACEUTICO = 'FARMACEUTICO',
  LABORATORISTA = 'LABORATORISTA',
  TERAPEUTA = 'TERAPEUTA',
}

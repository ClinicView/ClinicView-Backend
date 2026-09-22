# Inicialización que conserva decisiones administrativas

`prisma/seed.ts` prepara el catálogo inicial; no es una herramienta para restaurar
privilegios, reparar roles, restablecer contraseñas ni migrar una matriz de permisos.
No contiene cuentas ni contraseñas predeterminadas.

## Qué ocurre al volver a ejecutarlo

- Las capacidades ausentes se crean. Las descripciones existentes se conservan.
- Un rol ausente se crea con sus permisos predeterminados en una sola escritura
  anidada de Prisma. Si falla una relación, no queda un rol vacío a medio crear.
- Un rol existente mantiene nombre, descripción, permisos agregados y permisos
  retirados. Tampoco se modifica su fecha de actualización.
- Una capacidad nueva del catálogo **no se añade automáticamente a roles
  existentes**, ni siquiera a `ADMINISTRADOR`. Cualquier concesión posterior
  requiere una decisión administrativa explícita y revisada; no se obtiene
  reejecutando el seed.

## Cuenta administrativa inicial opcional

Se solicita mediante `ADMIN_EMAIL` y `ADMIN_PASSWORD`; `ADMIN_USERNAME` y
`ADMIN_FULL_NAME` son opcionales. Los valores no se imprimen en los logs.

1. Si faltan correo o contraseña, el seed omite esta creación.
2. Si ese correo ya pertenece a una cuenta, sin distinguir mayúsculas, se
   conserva íntegra: contraseña, nombre, estado activo/inactivo y roles. No se
   eleva una cuenta clínica a administrador ni se repone un rol retirado.
3. Si el nombre de usuario pertenece a otra cuenta, se aborta la creación.
4. Solo una identidad nueva recibe el rol `ADMINISTRADOR`, junto con su creación
   en una única escritura anidada. No se amplían los permisos del rol existente.

Una colisión concurrente de correo o clave de rol conserva la identidad ganadora
sin añadirle privilegios. Una colisión diferente se informa sin datos de cuentas.
No debe usarse el seed como mecanismo de recuperación de acceso de administradores.

## Pruebas locales sin base de datos

```bash
node --test scripts/bootstrap-preservation.test.cjs
```

Las pruebas importan únicamente `prisma/seed-access.ts`, que no crea un
`PrismaClient`, no lee archivos `.env` ni abre conexiones. Usan identidades
sintéticas y un almacenamiento en memoria para comprobar preservación,
idempotencia, colisiones y las escrituras anidadas. No ejecutan `seed.ts`.

La atomicidad real de esas escrituras la proporciona Prisma/PostgreSQL; los
mocks comprueban que el código usa ese límite y no emite concesiones separadas.
Esto no sustituye una prueba de integración contra una base aislada autorizada.
No ejecutar el seed en la base clínica para comprobar estas regresiones.

Referencia: [escrituras anidadas y transacciones de Prisma 6](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions#nested-writes).

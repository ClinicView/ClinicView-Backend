# Dependencias: revisión del 7 de septiembre de 2026

Resultado de `npm audit --omit=dev` tras esta actualización: **8 alertas**
(3 altas, 5 moderadas, ninguna crítica), frente a 14 antes del cambio.
Son resultados del árbol de dependencias, no una certificación de seguridad ni
una demostración de que cada aviso sea explotable en ClinicView.

## Actualizado y verificado

- bcrypt 6 elimina la cadena de instalación `node-pre-gyp -> tar` presente en
  bcrypt 5. La API de hash/comparación continúa funcionando; una prueba usa un
  hash sintético generado con bcrypt 5.1.1 para verificar la compatibilidad.
  No se cambian contraseñas ni hashes de usuarios existentes.
- Overrides acotados a la versión mayor: lodash 4.18.1, js-yaml 4.3.1 y
  brace-expansion 1.1.18. Se conservan los overrides anteriores.
- Se repiten pruebas unitarias, E2E aisladas, tipos, lint y build.

Referencia primaria del cambio de instalación de bcrypt:
[release v6.0.0](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0).

## Pendiente antes de una exposición pública

- NestJS 10 y su cadena `file-type`: 5 alertas moderadas agregadas. La corrección
  integral requiere evaluar una migración coordinada de Nest, adaptador HTTP y
  Swagger; no se fuerza una actualización mayor de un framework clínico con
  `npm audit fix --force`.
- `deepmerge-ts` a través de `@prisma/config` y el CLI de Prisma: 3 alertas altas
  agregadas. El origen es la configuración de Prisma; no es el lector de imágenes
  clínicas. El CLI está en devDependencies pero aparece en el árbol auditado por
  la relación peer de Prisma Client. No se rebaja Prisma automáticamente a 6.12.
- Las herramientas de desarrollo tienen alertas adicionales. `--omit=dev` no
  significa que una instalación completa esté libre de avisos.

Repetir la auditoría al preparar el despliegue: los avisos y versiones disponibles
cambian. MFA, aislamiento por institución/paciente, restauración de backups y
revisión del entorno de producción siguen siendo trabajos independientes.

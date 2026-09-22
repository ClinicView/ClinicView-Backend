# Dependencias: revisión del 22 de septiembre de 2026

La auditoría completa y `npm audit --omit=dev` reportan **0 avisos** con el lockfile
de esta revisión (npm 11.6.1, Node 24.11.0). Antes del cambio, la auditoría de
producción reportaba 9 avisos, 5 altos y 4 moderados. El resultado está fechado:
no es una certificación de seguridad ni garantiza ausencia de vulnerabilidades.

## Actualización coordinada, sin cambios a la base clínica

- NestJS common/core/platform-express/testing 11.1.18, Config 4.0.4, Swagger
  11.4.7, CLI 11.0.24 y Schematics 11.0.10. Se mantiene CommonJS; no se migra a
  Nest 12 ni se fuerza `npm audit fix --force`.
- Express 5.2.1 y body-parser 2.3.0. El middleware de contexto usa `{*path}`
  para incluir también la raíz con la sintaxis de comodines de Express 5.
- js-yaml 4.3.2; se actualizan las transitivas de herramientas de desarrollo
  dentro de los rangos admitidos. `npm ls --depth=0` no reporta peers inválidos.
- Prisma y Prisma Client siguen en 6.19.3. Solo `@prisma/config` recibe un
  override de `deepmerge-ts` 8.0.0; no cambia el esquema ni las migraciones.
  La versión 8 cambia la fusión de valores Map y admite referencias circulares.
  Se verifica la fusión de objetos/arrays, la inmutabilidad de las entradas, las
  referencias circulares y el cargador real de configuración de Prisma. Este
  override debe reevaluarse al actualizar Prisma, no copiarse globalmente.
- Mínimo de Node declarado: 20.19.0. Las pruebas de navegador/PDF requieren
  Node 22.13+ o 24+; esta revisión se prueba con Node 24.11.0.

Fuentes primarias: [migración a Nest 11](https://docs.nestjs.com/v11/migration-guide),
[aviso de Nest corregido en 11.1.18](https://github.com/nestjs/nest/security/advisories/GHSA-36xv-jgw5-4q75),
[deepmerge-ts 8.0.0](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[corrección js-yaml](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).

## Verificación reproducible

```powershell
npm audit
npm audit --omit=dev
npm ls --depth=0
node --test scripts/dependency-compatibility.test.cjs
node --test scripts/bootstrap-preservation.test.cjs
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Las pruebas E2E se ejecutan únicamente con los arneses de seguridad y una base
de pruebas: `npm run test:e2e` usa `E2E_DATABASE_URL`; el arnés de navegador del
frontend usa `BROWSER_E2E_DATABASE_URL` y un esquema distinto. Nunca deben apuntar
a la base clínica habitual. El OCR del arnés de navegador es sintético: comprueba
integración, revisión/publicación y PDF, no precisión del modelo.

Resultados locales del 22 de septiembre: 668 pruebas unitarias en 71 suites;
29 E2E de backend; 17 pruebas del bootstrap y 3 de compatibilidad de dependencias;
typecheck, lint y build aprobados. La prueba coordinada con el frontend aprobó
22 casos de navegador/PDF (incluido el flujo clínico completo) y 222 pruebas
unitarias del frontend. También compiló el frontend de producción tanto en el
arnés aislado como para uso local, con la API local configurada explícitamente.
No se aplicaron migraciones a `clinicview_dev`: los arneses usan esquemas propios
de `clinicview_test` y fixtures sintéticos. Tras reiniciar el backend local,
`/api/health/ready` devolvió BD y storage `ok`, IA `skipped` (no evaluada).

No se modifican Docker, configuración de VPS, cuentas locales, contraseñas,
historias clínicas ni pesos del modelo. La revisión de infraestructura, HTTPS,
copias/restauración y capacidad de procesamiento sigue siendo independiente.

## Historial: revisión del 7 de septiembre de 2026

Los pendientes de dependencias que siguen abajo corresponden a esa fecha y
quedan sustituidos por la actualización del 22 de septiembre descrita arriba.

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

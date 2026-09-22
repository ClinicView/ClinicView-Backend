# Runtime: controles verificados en local

Este bloque cambia código y pruebas; no modifica variables locales, cuentas,
historias, infraestructura ni el modelo activo. No constituye una aprobación
del entorno de producción ni una medición de capacidad o precisión OCR.

## Configuración

El arranque valida las variables sin imprimir sus valores. Desarrollo y pruebas
conservan sus valores predeterminados existentes. `NODE_ENV`, si se proporciona,
solo admite `development`, `test` o `production`.

En `production` se requieren:

- `DATABASE_URL` PostgreSQL explícita.
- `FRONTEND_URL` como origen HTTPS, sin credenciales, ruta, query ni fragmento.
- `IA_INTERNAL_URL` como origen HTTP(S) explícito, sin credenciales ni componentes
  adicionales. HTTP solo es apropiado en una conexión interna protegida.
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `AUDIT_HASH_SECRET` y
  `IA_INTERNAL_API_KEY`: al menos 32 caracteres, diferentes entre sí, sin
  espacios ni caracteres de control, placeholders conocidos ni valores trivialmente repetidos. Estos controles no
  demuestran entropía: deben generarse aleatoriamente y protegerse.

Swagger queda deshabilitado en producción incluso si un caller solicita
`enableSwagger: true`. La opción `enableSwagger: false` del arnés sigue vigente.
La cookie existente conserva `HttpOnly`, `SameSite=Strict` y `Secure` en producción.

`TRUST_PROXY_HOPS` solo acepta `0` (predeterminado) o `1`. No se debe habilitar `1`
si existe acceso directo a la API: se confiaría en cabeceras del cliente. Este
ajuste afecta a IP de rate limiting y auditoría; no agrega infraestructura ni
almacenamiento distribuido a los límites actuales.

## Vida y disponibilidad

- `GET /api/health` conserva el contrato de vida anterior. `/api/health/live` es
  un alias. No consulta datos ni depende de la IA.
- `GET /api/health/ready`: HTTP 200 con `status: ready` o HTTP 503 con
  `status: not_ready`. `checks` solo expone `database`, `storage`, `ia` con estados
  `ok`, `unavailable` o `skipped`; nunca rutas, URLs, errores internos o secretos.
- BD: `SELECT 1`, sin lectura de pacientes ni escritura.
- Storage: directorio, permisos de lectura/escritura y espacio disponible. Es
  una comprobación de metadatos, no escribe un archivo de prueba ni acredita una
  restauración, la durabilidad del volumen o una reserva de capacidad.
- `READY_REQUIRE_IA=false` por defecto: no consulta la IA y marca `ia: skipped`.
  Al habilitarlo consulta únicamente `GET /ready` autenticado y requiere
  `status: ready`. No carga el modelo ni ejecuta inferencia. Una IA fría puede
  declarar `not_ready` hasta su primera carga autorizada; esto no bloquea las
  rutas canónicas de subida/encolado, que no usan este endpoint como autorización.
- `HEALTH_TIMEOUT_MS`: 250–10000 ms; predeterminado 3000. Las sondas se ejecutan
  juntas y los resultados se reutilizan 5 segundos. Peticiones simultáneas y
  sondas nativas aún pendientes se agrupan para no multiplicar consultas ante
  timeouts. Puede existir un desfase de hasta cinco segundos en el estado.

La ruta legacy `POST /v1/process` también envía la clave interna; no reintenta la
inferencia ni refleja el cuerpo de errores del worker. El backend no tiene un
cliente para `POST /v1/metrics`. El protocolo durable mantiene su autenticación.

## Verificación local

Pruebas unitarias: configuración negativa sin eco de valores, Swagger/proxy,
HTTP 503, fallos y límites de las sondas, IA opcional/sin inferencia, espacio
agotado y autenticación del transporte legacy. Las pruebas de readiness usan
dobles de BD/storage/IA; no conectan a la base clínica. El transporte HTTP usa
únicamente servidores sintéticos efímeros sobre loopback.

Comandos: `npm test -- --runInBand`, `npm run typecheck`, `npm run lint`.
Las E2E de PostgreSQL requieren el arnés y base aislados; no ejecutar contra
la base de uso habitual.

Verificación del 22 de septiembre de 2026, después de la actualización coordinada
de dependencias: `npm test -- --runInBand` aprobó **668 pruebas en 71 suites**;
`npm run typecheck` y `npm run lint` terminaron sin errores. No se realizó una
inferencia real ni se accedió a datos clínicos desde estas pruebas unitarias.
Las comprobaciones E2E aisladas y de navegador se registran por separado; no se
incluyen en ese recuento.

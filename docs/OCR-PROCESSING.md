# Procesamiento OCR persistente

## Alcance (septiembre de 2026)

La web encola trabajos recuperables; ya no dispara una petición de inferencia
en memoria cuya vida dependa del proceso NestJS. Este cambio mejora continuidad
y trazabilidad, no precisión del modelo, ni aprobación clínica automática.

```text
Web → PostgreSQL: documento PROCESSING + intento UUID (una transacción)
Coordinador → IA: consultar/enviar el mismo UUID + hash
IA → almacenamiento privado: progreso + resultado persistentes
Coordinador → páginas verificadas → transacción: run + PROCESSED + SUCCEEDED
Web → asignación → revisión humana → validación → publicación clínica → exportación
```

La tabla `document_processing_jobs` conserva identidad, hash, número de intento,
versión clínica reclamada, estado, progreso, actor, fechas y reserva del worker.
No contiene PDF ni texto OCR. La migración
`20260917120000_durable_ocr_jobs` es aditiva y no reescribe historias ni revisiones.
El historial de intentos se conserva por la aplicación; no tiene un trigger de
inmutabilidad como los runs y revisiones espaciales existentes.

## Contrato web

`POST /api/patients/:patientId/documents/:id/process` acepta
`{ "expectedVersion": 0 }`. Usa los permisos y controles de paciente activo
existentes (`documents.upload`); no incorpora validación ni publicación.

- La misma versión de partida devuelve el intento ya aceptado, incluso si
  terminó mientras se perdió la respuesta. Dos solicitudes simultáneas no
  crean dos intentos (CAS de versión + transacción).
- Solo se crea un nuevo UUID en `PENDING`, o tras un fallo/interrupción
  confirmado cuyo error permita reintentar. Se recomienda siempre enviar
  `expectedVersion`; su omisión se conserva por compatibilidad.
- Un archivo mayor de 20 MiB se rechaza antes de reclamar el documento, aunque
  el límite general de subida se hubiera elevado. IA limita además páginas y
  píxeles; no trunca silenciosamente PDFs demasiado grandes.
- `GET` del documento devuelve `processing` con `jobId`, `attempt`, `status`,
  `progress`, fechas, latido, error y `canRetry`; es `null` para documentos legacy.
  No realiza una llamada a IA. Los contadores no incrementan la versión clínica.

Estados del intento: `QUEUED`, `RUNNING`, `WAITING_FOR_WORKER`, `FINALIZING`,
`SUCCEEDED`, `FAILED`, `INTERRUPTED`. `PROCESSING/PROCESSED` siguen siendo estados
del documento, no del intento. `PROCESSED` significa listo para revisión, nunca
historia validada. Totales desconocidos son `null`; no se calculan porcentajes
temporizados. El latido indica vida del worker, no avance del reconocimiento.

## Recuperación y exclusión

- El coordinador consulta cada segundo hasta cuatro intentos vencidos. Cada uno
  usa una reserva PostgreSQL de 120 s, renovada cada 40 s; el token de reserva y
  la versión clínica delimitan la escritura final. Varios backend pueden
  consultar la cola sin publicar el mismo resultado dos veces.
- Reiniciar el backend permite recuperar reservas vencidas. Nunca marca en
  bloque como fallidos los trabajos durables. Los `PROCESSING` antiguos sin
  trabajo sí se recuperan como `FAILED`, pues carecen de identidad remota.
- Red caída, timeout o respuesta incierta producen `WAITING_FOR_WORKER` y
  consultas con espera progresiva de 3 a 60 s. No vuelven a ejecutar IA con un
  ID nuevo. Un 404 permite enviar el mismo UUID solo antes del primer acuse.
- Si un UUID previamente confirmado desaparece en IA, se conserva pendiente
  para intervención: no se presume que el cálculo haya dejado de ejecutarse.
- IA confirma sus interrupciones al reiniciarse con propiedad exclusiva de su
  cola. Un reintento explícito crea otro UUID/run y procesa desde el inicio;
  no retoma un lote parcial ni altera revisiones históricas.
- El resultado se recupera mediante peticiones cortas autenticadas. Se verifica
  identidad documento/hash/run; todas las páginas deben estar conservadas y
  coincidir con las dimensiones del layout antes de publicar. Una página
  inaccesible no se convierte en éxito parcial.
- La actualización de intento/documento/run es atómica. Las notificaciones son
  posteriores: un fallo de campana no revierte el resultado, aunque un crash
  justo tras el commit puede dejarlo sin esa notificación.

No hay cancelación del proceso nativo ni recuperación desde un checkpoint de
TrOCR. Un modelo bloqueado requiere intervención operativa, no un timeout que
autorice otra inferencia mientras la anterior todavía podría escribir.

## Configuración y despliegue

1. Respaldar PostgreSQL, storage y cola IA con un procedimiento consistente.
2. Detener workers IA antiguos: cambió el protocolo del lock de publicación.
3. Aplicar `npx prisma migrate deploy` y generar Prisma al construir el backend.
4. Desplegar IA con su cola privada persistente y una única instancia por
   directorio; luego backend y frontend compatibles.
5. Configurar la misma `IA_INTERNAL_API_KEY` aleatoria de al menos 32 caracteres
   en backend/IA; nunca en variables `NEXT_PUBLIC_*` ni en Git.

`IA_JOB_TIMEOUT_MS=15000` admite 1000–60000 ms: limita cada solicitud pequeña,
no la inferencia. `OCR_JOBS_WORKER_ENABLED=false` desactiva el consumidor en ese
backend (debe existir otro si se quiere procesar); en tests está apagado salvo
habilitación explícita. `IA_PROCESS_TIMEOUT_MS` solo sirve a la ruta legacy.

La página preservada tiene un límite individual configurable
`IA_MAX_PAGE_IMAGE_BYTES` (25 MiB por defecto); el caché de un documento admite
256 MiB. Si se supera este presupuesto total, el intento local queda en `FAILED`
con `ARTIFACT_CACHE_LIMIT` y sin reintento OCR habilitado; el resultado remoto se
conserva para revisión técnica. Corrupción, falta de espacio o páginas inaccesibles
mantienen la reconciliación: no se publica un resultado parcial. Consultar estado
y almacenamiento antes de resolver la incidencia; no eliminar el UUID remoto
para forzar retry. La limpieza tras un commit de resultado incierto preserva los
archivos potencialmente publicados, aun a costa de dejar archivos huérfanos para
una posterior conciliación operativa; nunca adivina que un commit falló.

La cola SQLite de IA contiene entrada temporal y resultados clínicos; sus
artefactos, PostgreSQL y uploads requieren volumen persistente privado, ACL,
copias/restauración y política de retención institucional. No son datos
anonimizados ni están cifrados por esta funcionalidad. La eliminación lógica
de entrada de IA al terminar no implica borrado forense de copias/WAL.

## Verificación

Comprobación local del 17 de septiembre de 2026:

| Comando | Resultado |
| --- | --- |
| `npm run lint` | Sin errores ni advertencias |
| `npm test -- --runInBand` | 593 pruebas aprobadas, 67 suites |
| `npm run typecheck` | Sin errores de TypeScript |
| `npm run test:e2e` | 29 pruebas aprobadas, 2 suites; PostgreSQL aislado |

La ejecución E2E utilizó exclusivamente `clinicview_test` con el esquema
`clinicview_e2e`; no reinició servicios de la aplicación ni modificó la base
de desarrollo. El runner exige una URL de pruebas explícita y limita su
preparación/limpieza a ese esquema. La suite de navegador hasta PDF **no** forma
parte de estos resultados.

- Cliente HTTP: identidad, hash real, límites de respuesta, clave, timeouts,
  estados inválidos y errores sin eco del contenido clínico.
- Coordinador: encolado, versión, pérdida de respuesta, lease, recuperación,
  resultado desalineado, cambio de fuente y reintento explícito.
- Publicación de páginas: pérdida del acuse del commit, indisponibilidad de la
  base, metadata inválida y conflictos conservan las copias potencialmente
  publicadas. El límite de 256 MiB se comprueba tanto al llenarse exactamente
  como antes de excederlo, sin alterar el comportamiento legacy.
- `npm run test:e2e`: PostgreSQL aislado y boundary IA simulado determinista;
  concurrencia, recuperación con nueva instancia backend, intentos anteriores
  conservados y flujo de validación/publicación clínica existente.
- IA prueba además reinicios, bloqueos de proceso, progreso real por lotes y
  persistencia atómica de resultado. No es un benchmark de exactitud clínica.

## Pendientes del flujo global

En la comprobación local del 17 de septiembre de 2026 se cargó un PNG sintético
de seis líneas desde la web. Se detuvo abruptamente el backend mientras IA
procesaba y se volvió a iniciar; el navegador recuperó automáticamente el
resultado. PostgreSQL confirmó un solo intento y un solo run: documento
`PROCESSED`, trabajo `SUCCEEDED`, una página, seis líneas y dos lotes completados.
No se corrigió, validó ni publicó este fixture como atención clínica. Esta prueba
manual asistida verifica recuperación real, no exactitud OCR ni el PDF final;
sus datos y capturas permanecen fuera de los repositorios.

El flujo clínico funcional ya existe, pero resta una prueba de navegador
reproducible desde subida hasta el PDF descargado, con su contenido/layout
verificados. También faltan mediciones CER/WER sobre referencia revisada y un
exportador espacial seguro para entrenar (el legacy bloquea estos documentos).
Extraer figuras/firmas y anexar páginas originales en el PDF son ampliaciones,
no requisitos para corregir texto manualmente. Despliegue multiinstitucional,
retención, monitorización/readiness y restauración deben validarse por separado
antes de uso productivo; las pruebas locales no certifican esa preparación.

Documentación relacionada: [flujo clínico](FLUJO-DIGITALIZACION.md) y
`ClinicView-IA-v2/docs/DURABLE-OCR-JOBS.md` / `ClinicView-Frontend/docs/OCR-PROCESSING.md`.

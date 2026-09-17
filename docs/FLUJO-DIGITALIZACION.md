# Flujo de digitalización de historias clínicas

Referencia end-to-end de lo que ocurre con un documento en el backend, desde
la subida hasta el fine-tuning del modelo. Complementa `iav2/docs/PIPELINE.md`
(lado IA) y los CONTEXT.md de cada módulo.

## Estados del documento

```
PENDING ──process──▶ PROCESSING ──OCR ok──▶ PROCESSED ──validate──▶ VALIDATED
   ▲                     │                      │
   │                     └──OCR falla──▶ FAILED─┘──reject──▶ REJECTED
   └───────────reintento (process)◀───── FAILED
```

- `PROCESSED` = "en corrección": tiene `ocrText` + `nerEntities` + `metrics`,
  espera corrección/validación humana.
- Un reinicio del backend conserva los trabajos persistentes en `PROCESSING`
  y vuelve a consultar el mismo UUID en IA. La pérdida de conexión no es un
  fallo terminal. Solo los documentos legacy sin identidad de trabajo pasan a
  `FAILED` al arrancar. Véase [trabajos OCR persistentes](OCR-PROCESSING.md).

## Paso a paso

1. **Subida** — `POST /patients/:patientId/documents` (multipart `file`).
   Se valida tipo (PDF/JPEG/PNG), extensión y tamaño (`UPLOAD_MAX_SIZE_MB`,
   por defecto 20). El binario va a `uploads/<patientId>/<uuid>.<ext>`
   (`StorageService`; configurable con `storage.uploadDir`). El paciente debe
   estar activo.

2. **Procesamiento** — `POST /patients/:patientId/documents/:id/process`, con
   `{ "expectedVersion": versionActual }`.
   Persiste de forma atómica documento e intento y responde con `PROCESSING`;
   el coordinador `ProcessingJobsService` consulta la cola sin mantener abierta
   la conexión del navegador durante el OCR:
   - Envía el binario al worker como `data:` URI a `POST /v1/jobs/{jobId}`,
     autenticado mediante clave interna, con hash SHA-256 y UUID idempotente.
   - Consulta estado/progreso y recoge el resultado durable; guarda las páginas
     preservadas antes de publicar el resultado y su ejecución espacial.
   - Con la respuesta guarda: `ocrText`, `nerEntities`, `metrics`
     (si están disponibles, normalizadas a camelCase), `ocrConfidence`
     y `confidenceLevel` (HIGH/MEDIUM/LOW).
   - Crea una **notificación** para el usuario que inició el proceso
     (`DOCUMENT_PROCESSED` o `DOCUMENT_FAILED`); la campana del frontend la
     recoge por polling y navega al documento.
   - La confianza no equivale a precisión medida. CER/WER requieren una
     transcripción de referencia; validar en la web no los recalcula todavía.

3. **Revisión humana** — el documento procesado debe estar asignado al revisor.
   - Con ejecución espacial, `GET .../:id/ocr-layout` devuelve páginas,
     fragmentos originales y última revisión. Las páginas preservadas se sirven
     por un endpoint privado autenticado, ligado al `runId`.
   - `PATCH .../:id/ocr-layout/review` recibe `runId`, `expectedVersion` y las
     líneas revisadas con texto, orden, geometría y procedencia. Guarda una
     revisión inmutable y reconstruye `correctedText` en la misma transacción;
     conserva usuario, nombre y versión. No sobrescribe el OCR ni valida
     clínicamente el documento por sí mismo.
   - La corrección textual/por secciones sigue disponible mediante
     `PATCH .../:id/correction`, con `correctedText` y/o `correctedEntities`.
     Tampoco modifica el OCR original. Sustituir una corrección previa desde la
     revisión espacial requiere confirmación explícita.

4. **Validación / rechazo** — `PATCH .../:id/validate` guarda la versión final y
   el checklist de forma atómica, controla la versión esperada, cambia a
   `VALIDATED` y sella `reviewedAt/reviewedBy`. La alternativa es
   `PATCH .../:id/reject`, con motivo. La validación no calcula CER/WER ni crea
   automáticamente una atención estructurada.

5. **Publicación vinculada** — `POST /patients/:patientId/records/from-document`
   crea una atención estructurada a partir de un original validado, con páginas
   de procedencia y cotejo humano explícito. Conserva el vínculo al documento;
   no presenta una transcripción automática como atención ya revisada.

6. **Confirmación y exportación** — `POST .../records/:id/confirm` confirma una
   versión clínica concreta; no es una firma digital certificada. El frontend
   pide `GET /patients/:patientId/clinical-history/export` y genera el PDF a
   partir del alcance completo devuelto, incluyendo atenciones manuales y sus
   adjuntos. Si una imagen incluida no puede recuperarse, se cancela la descarga
   en lugar de producir un archivo incompleto.

7. **Búsqueda** — `GET .../documents/search?q=` busca por palabra clave en
   `ocrText`/`correctedText`/`originalName` y devuelve snippets con contexto.

## Aceptación automatizada de navegador a PDF

El frontend incluye una suite reproducible que recorre carga, procesamiento,
revisión espacial, validación, publicación vinculada, consulta manual con imagen,
confirmación y descarga. Utiliza Chromium, Nest, autenticación, PostgreSQL y
almacenamiento reales en un entorno aislado. Solo el límite HTTP de OCR se
sustituye por un doble sintético determinista, sin acceder a modelos ni historias
clínicas reales.

Un parser independiente verifica el PDF descargado: contenido revisado, orden,
fechas, texto largo, imagen y exclusión del OCR aún no validado. La suite también
comprueba que una imagen inaccesible impida la descarga. Esta aceptación no mide
precisión OCR, no cubre todos los roles/navegadores y no sustituye la inspección
visual de las páginas. El arnés, las guardas de base de datos y su alcance están
documentados en [test/README.md](../test/README.md#aceptación-de-navegador-hasta-el-pdf).
La guía de ejecución del frontend es `docs/BROWSER-E2E.md` en ese repositorio.

## Exportación legacy y entrenamiento futuro

El exportador de texto **no genera automáticamente pares fiables para entrenar**.
Si algún documento candidato tiene una ejecución OCR espacial, el comando falla
sin escribir ni modificar archivos. Una corrección espacial puede haber cambiado
el orden, unido/dividido líneas o ajustado el recorte: emparejar por posición con
las imágenes antiguas produciría etiquetas incorrectas.

```bash
# Bloquea la salida si hay candidatos con ejecuciones espaciales:
node scripts/export-corrections.js

# Opción explícita: excluir TODOS los documentos con ejecuciones espaciales:
node scripts/export-corrections.js --legacy-only ruta-privada/export-legacy.jsonl

# Pruebas sintéticas del guard (no consultan la base ni exportan historias):
node --test scripts/export-corrections.test.js
```

Sin ruta explícita, la salida se resuelve al repositorio hermano
`ClinicView-IA-v2/data/annotations/webapp_corrections_export.jsonl`.
`--legacy-only` informa cuántos documentos excluyó; no autoriza a exportar líneas
espaciales ni las transforma a un formato antiguo. Los registros legacy incluyen
`alignmentVerified:false` y `trainingReady:false`. El estado `VALIDATED` tampoco
demuestra, por sí solo, que cada imagen coincida con su etiqueta de entrenamiento.

Se eliminó `patientCode`/documento de identidad del export. Esto **no anonimiza**
el texto clínico ni el nombre del archivo: la salida sigue siendo privada y no
debe subirse a Git, publicarse o enviarse automáticamente a servicios externos.

El constructor antiguo de IA utiliza el `lines.jsonl` raíz (última ejecución) y
alineación textual heurística. No conoce `runId`, revisiones, cambios de geometría
ni procedencia; no debe recibir correcciones espaciales, tampoco exports antiguos
ya existentes. El guard no modifica ni elimina exports generados anteriormente.

Un futuro exportador espacial deberá fijar `runId` y revisión, reconstruir los
recortes desde la página preservada usando la geometría humana, comprobar que las
líneas estén revisadas y vigentes, conservar la procedencia de uniones/divisiones,
y separar documentos/pacientes entre entrenamiento y evaluación sin fuga de datos.
Ese exportador y el entrenamiento todavía no forman parte de este cambio.

## Scripts disponibles (`backend/scripts/`)

| Script | Uso |
|---|---|
| `seed-demo.js` | Crea 4 pacientes de demostración con registros, documentos, PDF en storage y métricas. Idempotente. |
| `export-corrections.js` | Export privado legacy con guard contra ejecuciones espaciales; alineación no verificada. |
| `browser-e2e-server.cjs` | Nest real aislado y seed sintético para la aceptación de navegador/PDF. |

## Variables de entorno relevantes

| Variable | Efecto |
|---|---|
| `IA_INTERNAL_URL` | URL del worker IA (`http://localhost:8000` en local). |
| `UPLOAD_MAX_SIZE_MB` | Límite de subida (default 20). |
| `UPLOAD_DIR` / `storage.uploadDir` | Carpeta de binarios. En despliegues con disco efímero se requiere volumen persistente o storage externo antes de producción. |

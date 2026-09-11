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
- Si el servidor se reinicia con documentos en `PROCESSING`, al arrancar se
  marcan `FAILED` automáticamente (`MedicalDocumentsService.onModuleInit`) —
  el OCR en segundo plano murió con el proceso y puede reintentarse.

## Paso a paso

1. **Subida** — `POST /patients/:patientId/documents` (multipart `file`).
   Se valida tipo (PDF/JPEG/PNG), extensión y tamaño (`UPLOAD_MAX_SIZE_MB`,
   por defecto 20). El binario va a `uploads/<patientId>/<uuid>.<ext>`
   (`StorageService`; configurable con `storage.uploadDir`). El paciente debe
   estar activo.

2. **Procesamiento** — `POST /patients/:patientId/documents/:id/process`.
   Responde **de inmediato** con estado `PROCESSING`; el OCR corre en segundo
   plano (`runProcessing`):
   - Lee el binario y lo envía al worker IA (`IaClientService`) como
     `data:` URI base64 al endpoint `POST {IA_INTERNAL_URL}/v1/process`.
   - Con la respuesta guarda: `ocrText`, `nerEntities`, `metrics`
     (CER/WER/charAccuracy/NER, normalizadas a camelCase), `ocrConfidence`
     y `confidenceLevel` (HIGH/MEDIUM/LOW).
   - Crea una **notificación** para el usuario que inició el proceso
     (`DOCUMENT_PROCESSED` o `DOCUMENT_FAILED`); la campana del frontend la
     recoge por polling y navega al documento.

3. **Corrección** — `PATCH .../:id/correction` con `correctedText` y/o
   `correctedEntities`. El OCR original nunca se sobrescribe (trazabilidad).
   El frontend edita por secciones clínicas y reconstruye el texto plano.

4. **Validación / rechazo** — `PATCH .../:id/validate` (estado `VALIDATED`,
   sella `reviewedAt/reviewedBy`) o `PATCH .../:id/reject` (con motivo).

5. **Búsqueda** — `GET .../documents/search?q=` busca por palabra clave en
   `ocrText`/`correctedText`/`originalName` y devuelve snippets con contexto.

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

## Variables de entorno relevantes

| Variable | Efecto |
|---|---|
| `IA_INTERNAL_URL` | URL del worker IA (`http://localhost:8000` en local). |
| `UPLOAD_MAX_SIZE_MB` | Límite de subida (default 20). |
| `STORAGE_UPLOAD_DIR` / `storage.uploadDir` | Carpeta de binarios. ⚠️ En Railway el disco es efímero: usar volumen persistente o storage externo antes de producción. |

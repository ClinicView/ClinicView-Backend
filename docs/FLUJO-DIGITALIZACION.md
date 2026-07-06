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

## Ciclo de fine-tuning

Las correcciones humanas alimentan el reentrenamiento de TrOCR:

```bash
# 1. Exportar correcciones (documentos con correctedText):
node scripts/export-corrections.js
#    → iav2/data/annotations/webapp_corrections_export.jsonl

# 2. En iav2/: alinear con los recortes persistidos y entrenar
#    (ver iav2/docs/PIPELINE.md, sección "Ciclo de mejora")
```

El worker IA v2 guarda los recortes de línea de cada documento procesado en
`iav2/data/webapp_lines/<documentId>/` — ese `documentId` es el UUID de
`medical_documents`, lo que permite emparejar recorte ↔ corrección.

## Scripts disponibles (`backend/scripts/`)

| Script | Uso |
|---|---|
| `seed-demo.js` | Crea 4 pacientes de demostración con registros, documentos, PDF en storage y métricas. Idempotente. |
| `export-corrections.js` | Exporta correcciones para el dataset de fine-tuning. |

## Variables de entorno relevantes

| Variable | Efecto |
|---|---|
| `IA_INTERNAL_URL` | URL del worker IA (`http://localhost:8000` en local). |
| `UPLOAD_MAX_SIZE_MB` | Límite de subida (default 20). |
| `STORAGE_UPLOAD_DIR` / `storage.uploadDir` | Carpeta de binarios. ⚠️ En Railway el disco es efímero: usar volumen persistente o storage externo antes de producción. |

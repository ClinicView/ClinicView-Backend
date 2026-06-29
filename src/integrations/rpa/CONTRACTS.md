# CONTRACTS.md — Backend ↔ RPA (n8n)

> Contrato entre el backend y la herramienta RPA. Implementación MVP: n8n vía webhooks HTTP.
> n8n es **reemplazable**: este contrato define la interfaz, no la herramienta.

## 1. Partes
- **Lado A:** `backend` → `integrations/rpa` (`RpaClient`).
- **Lado B:** n8n (u otra herramienta RPA).
- **Mecanismo:** HTTP (webhook de entrada a n8n; callback opcional de vuelta al backend).

## 2. Operaciones

### `triggerWorkflow(name, payload)`
- Dispara un flujo por nombre lógico (mapeado a un webhook de n8n en `config`).
- **Request** (a n8n):
```jsonc
{ "workflow": "string", "correlationId": "string (opaco)", "payload": { } }
```
- **Response**: `{ "runId": "string", "accepted": true }`.

### `getRunStatus(runId)`
- **Response**: `{ "runId": "string", "status": "PENDING|RUNNING|DONE|FAILED" }`.

### Callback (n8n → backend, opcional)
- `POST /api/integrations/rpa/callback` con `{ "correlationId", "status", "result" }`. Autenticado por
  secreto compartido (de `config`).

## 3. Reglas de datos
- Preferir `correlationId`/refs sobre datos clínicos. Nada de nombres/diagnósticos en el payload salvo
  necesidad justificada y protegida.

## 4. Errores y reintentos
- Reintentos idempotentes por `correlationId`. Timeouts desde `config`.

## 5. Evolución
- Cambiar de n8n a otra herramienta: nueva impl. de `RpaClient`, mismo contrato lógico. Documentar en
  `docs/decisions` y `docs/rpa`.

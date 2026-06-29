# CONTRACTS.md — Backend ↔ Almacenamiento de archivos

> Contrato entre el dominio y el almacenamiento de binarios clínicos. Impl. MVP: FS local; futuro:
> S3-compatible. Mismo `StorageClient`.

## 1. Partes
- **Lado A:** `medical-documents`, `document-processing` → `integrations/storage`.
- **Lado B:** proveedor de almacenamiento (FS / S3).

## 2. Operaciones

### `save(file, metadata) → { fileRef }`
- Guarda el binario; devuelve referencia opaca. `metadata` mínima: `mimeType`, `size`, `documentId`.

### `getSignedUrl(fileRef, ttlSeconds) → { url, expiresAt }`
- URL temporal de lectura. Usada por `ia/` para descargar el binario a procesar.

### `delete(fileRef)`
- Borrado lógico/físico según política de retención (ver `docs/security`).

## 3. Reglas de datos
- Solo binarios + metadata técnica mínima. Nada de PII en la ref ni en el nombre.
- Acceso siempre por URL firmada con expiración corta.

## 4. Errores
- `NotFound` si la ref no existe; `Forbidden` si la URL expiró. Sin filtrar rutas internas.

## 5. Evolución
- FS→S3: nueva impl. de `StorageClient`. El contrato no cambia.

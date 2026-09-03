# SECURITY.md — audit/

## Datos
Metadatos de acciones. Prohibido almacenar contenido clínico o PII en claro.

## Acceso
Lectura restringida a `Administrador` (permiso `admin.audit.read`). Escritura solo vía servicio
interno; no existen endpoints para modificar o eliminar eventos.

## Integridad
Append-only reforzado en PostgreSQL: `UPDATE`, `DELETE` y `TRUNCATE` se rechazan mediante triggers.

## Acciones que deben auditarse (mínimo)
Login/logout, acceso a ficha de paciente, subida/descarga de documentos, validación/rechazo, creación/
edición/anulación de registros clínicos, cambios de usuarios/roles.

## Checklist
- [x] Sin PHI/PII en claro.
- [x] Append-only.
- [x] Lectura solo admin.
- [x] Cobertura explícita de acciones sensibles y fallback para rutas autenticadas restantes.

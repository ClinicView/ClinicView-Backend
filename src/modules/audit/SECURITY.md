# SECURITY.md — audit/

## Datos
Metadatos de acciones. Prohibido almacenar contenido clínico o PII en claro.

## Acceso
Lectura restringida a `Administrador` (permiso `audit:read`). Escritura solo vía servicio interno.

## Integridad
Append-only; considerar protección contra manipulación (hash encadenado opcional a futuro).

## Acciones que deben auditarse (mínimo)
Login/logout, acceso a ficha de paciente, subida/descarga de documentos, validación/rechazo, creación/
edición/anulación de registros clínicos, cambios de usuarios/roles.

## Checklist
- [ ] Sin PHI/PII. [ ] Append-only. [ ] Lectura solo admin. [ ] Cobertura de acciones sensibles.

# SECURITY.md — clinical-records/

## Datos sensibles
Contenido clínico completo (PHI): diagnósticos, evolución, plan terapéutico.

## Control de acceso
Solo roles con permiso clínico (`clinical-records:read`/`:write`). Un usuario solo accede a registros
acorde a su servicio/permisos.

## Logging
Nunca loguear contenido clínico. Solo `recordId`, `patientId` (opaco), acción y autor.

## Auditoría
Toda creación/edición/anulación de un registro clínico se audita con autor, fecha y versión previa.

## Checklist
- [ ] Permiso clínico requerido. [ ] Sin PHI en logs. [ ] Versionado y auditado. [ ] Origen trazable.

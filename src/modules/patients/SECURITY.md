# SECURITY.md — patients/

## Datos sensibles
Identificación y datos demográficos (PII). Posible vinculación a condiciones clínicas (PHI indirecta).

## Control de acceso
Lectura/edición solo para roles con permiso `patients:read` / `patients:write`. Listados masivos
restringidos.

## Logging
Nunca loguear nombre, documento de identidad ni contacto. Usar `patientId` opaco.

## Reglas
- Cifrado en reposo de identificadores sensibles según `docs/security`.
- Acceso a la ficha de un paciente se audita (quién consultó qué y cuándo).

## Checklist
- [ ] Permiso requerido. [ ] PII no logueada. [ ] Accesos auditados. [ ] Cifrado aplicado.

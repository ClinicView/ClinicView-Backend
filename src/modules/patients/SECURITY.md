# SECURITY.md — patients/

## Datos sensibles
Identificación y datos demográficos (PII). Posible vinculación a condiciones clínicas (PHI indirecta).

## Control de acceso
Lectura, alta y edición solo para roles con los permisos `patients.read`, `patients.create` y
`patients.update`, respectivamente. Los listados masivos permanecen restringidos.

## Logging
Nunca loguear nombre, documento de identidad ni contacto. Usar `patientId` opaco.

## Reglas
- Cifrado en reposo de identificadores sensibles según `docs/security`.
- Acceso a la ficha de un paciente se audita (quién consultó qué y cuándo).
- Los borradores de alta son privados por usuario, no se exponen en logs ni respuestas ajenas,
  usan control optimista por ID + versión y expiran como máximo en 30 días (7 por defecto).
- El alta consume el borrador dentro de la misma transacción que crea al paciente.

## Checklist
- [ ] Permiso requerido. [ ] PII no logueada. [ ] Accesos auditados. [ ] Cifrado aplicado.

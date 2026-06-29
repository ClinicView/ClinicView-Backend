# TESTING.md — manual-clinical-entry/

## Unit
- Transiciones de estado válidas/ inválidas (DRAFT→SAVED→VALIDATED→CORRECTED, VOIDED).
- Validación por sección (campos requeridos vs. opcionales según estado).
- Construcción del `ClinicalRecord` a partir del registro manual (mapeo correcto, `source = MANUAL`).

## Integration
- Crear borrador, editarlo, validarlo y verificar que se crea el `ClinicalRecord` asociado.
- Permisos: solo roles clínicos pueden crear/validar.
- Auditoría: cada acción genera entrada en `audit`.

## E2E (con frontend)
- Flujo completo: seleccionar/crear paciente → llenar secciones → guardar borrador → validar.

## Datos
- Sintéticos. Nunca datos clínicos reales.

## Checklist
- [ ] Estados probados. [ ] Validación por sección. [ ] Creación de ClinicalRecord. [ ] Permisos. [ ] Auditoría.

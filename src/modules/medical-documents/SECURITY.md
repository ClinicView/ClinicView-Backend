# SECURITY.md — medical-documents/

## Datos sensibles
Archivos clínicos (PHI) e imágenes de historias. Alto riesgo.

## Validación de subida
- Lista blanca de extensiones (jpg, png, pdf) y verificación de **MIME real** (magic bytes).
- Límite de tamaño configurable. Rechazo claro de archivos no válidos.
- Escaneo/saneamiento básico; nombres de archivo generados (no usar el nombre del cliente).

## Almacenamiento
- Binarios en `integrations/storage` con acceso restringido (URLs firmadas/temporales).
- Cifrado en reposo. Sin acceso público directo.

## Control de acceso y logging
- Permisos `documents:upload`/`:read`/`:validate`. Descargas auditadas.
- Nunca loguear contenido del archivo ni datos del paciente; solo `documentId` opaco.

## Checklist
- [ ] MIME real validado. [ ] Tamaño limitado. [ ] URLs firmadas. [ ] Cifrado. [ ] Accesos auditados.

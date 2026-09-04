# SECURITY.md — audit/

## Datos
Metadatos de acciones. El único identificador humano persistido es el `username` institucional
del actor al momento del evento. Se prohíbe almacenar contenido clínico, nombre completo, correo,
documento de identidad, contraseñas, cuerpos/consultas HTTP o mensajes de error.

La lectura incorpora nombre, username y estado **actuales** mediante una proyección restringida del
usuario; esos datos no se duplican en el evento y la consulta no selecciona otros campos del perfil.

## Acceso
Lectura restringida a `Administrador` (permiso `admin.audit.read`). Escritura solo vía servicio
interno; no existen endpoints para modificar o eliminar eventos.

## Integridad
Append-only reforzado en PostgreSQL: `UPDATE`, `DELETE` y `TRUNCATE` se rechazan mediante triggers.

## Acciones que deben auditarse (mínimo)
Login/logout, acceso a ficha de paciente, subida/descarga de documentos, validación/rechazo, creación/
edición/anulación de registros clínicos, cambios de usuarios/roles.

## Checklist
- [x] Sin PHI ni PII innecesaria; snapshot limitado al username institucional.
- [x] Append-only.
- [x] Lectura solo admin.
- [x] Cobertura explícita de acciones sensibles y fallback para rutas autenticadas restantes.

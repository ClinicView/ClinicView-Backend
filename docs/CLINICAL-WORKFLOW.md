# Flujo clínico ampliado (sin IA)

## Publicación humana de atenciones

POST /patients/:patientId/records/from-document añade a CreateRecordDto:
sourceDocumentId, expectedDocumentVersion, pageFrom/pageTo, sourceNote,
sourceVerified=true y publicationKey (UUID único de la operación).

La transacción serializable valida paciente/actor activos, pertenencia del original,
estado VALIDATED, asignación, versión y rango de páginas. El incremento CAS del
documento, la atención DIGITIZED, la cita, los adjuntos y el consumo del borrador
se confirman juntos. Una colisión/reenvío devuelve 409 y no duplica atenciones.
La clave interna de publicación no se expone en respuestas ni exportaciones.

Las citas son inmutables en PostgreSQL. Las correcciones heredan una copia sin
reutilizar la clave de publicación; una cita errónea exige anulación y nueva
publicación. GET records?sourceDocumentId=UUID&status=ALL permite consultar la cadena.

attendancePrecision=DAY admite YYYY-MM-DD validada; se almacena el inicio del día
de Lima conservando la precisión explícita. INSTANT conserva el contrato ISO con
zona y la precisión existente. No se inventa una hora al presentar/exportar DAY.
Los registros nuevos conservan el nombre del ingresante; no se fabrican nombres
para registros históricos. El profesional original sigue siendo independiente.

Pruebas E2E: permisos, rangos/fechas inválidos, documento ajeno, doble envío
concurrente, reenvío, herencia de cita, inmutabilidad y exportación.

Aplicar prisma:migrate:deploy y regenerar Prisma. Migración aditiva:
20260907130000_clinical_record_sources. No se ejecuta ni modifica IA.

## Confirmación de una versión

POST records/:id/confirm requiere patients.read, records.read y records.confirm,
expectedVersion y attested=true; note es opcional. La operación valida la versión
activa, paciente/actor activos y profesional identificado. Guarda nombre/usuario,
fecha, versión y huella SHA-256 del contenido en una tabla inmutable. El cierre
interno no acredita colegiatura ni equivale a firma digital certificada.

La cuenta vinculada al profesional original se identifica como tal; cualquier
otro confirmante autorizado queda como revisor, sin sustituir al profesional.
La corrección crea una atención pendiente de confirmar y conserva el cierre
anterior. La anulación tampoco borra el cierre histórico. La exportación incluye
ambos estados. No hay confirmaciones retroactivas inventadas para datos existentes.

Migración 20260907140000_record_confirmation: agrega records.confirm a roles base
clínicos y administrador; los roles personalizados se configuran en Administración.
Las sesiones deben renovar sus permisos o volver a iniciar sesión. La migración
también refuerza en BD que la cita y la atención pertenezcan al mismo paciente.

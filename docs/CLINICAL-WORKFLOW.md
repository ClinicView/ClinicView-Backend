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

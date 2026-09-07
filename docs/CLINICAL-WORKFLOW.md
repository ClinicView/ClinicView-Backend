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

## Episodios clínicos

Migración 20260907150000_clinical_episodes. Endpoints del paciente:
GET/POST episodes; PATCH episodes/:id; POST episodes/:id/transition;
GET episodes/:id/history; PATCH records/:id/episode.
La lectura exige patients.read + records.read. Crear, editar o agrupar exige
además records.create; cerrar/reabrir exige records.confirm. Los cambios envían
la versión observada y motivo. El cierre/reapertura requiere atestación explícita.

La asignación es opcional, no cambia contenido clínico confirmado y no fusiona
atenciones. Solo agrupa versiones vigentes en episodios abiertos del mismo
paciente, validando que la fecha no preceda al inicio. Cerrar exige al menos una
atención activa, todas confirmadas y una fecha que no excluya atenciones.
Las correcciones heredan el episodio y vuelven a quedar pendientes de confirmar.
Corregir, anular y reagrupar exige reabrir previamente un episodio cerrado.

Operaciones concurrentes se serializan con bloqueo de episodios y CAS; los
conflictos revierten la operación completa. La base refuerza pertenencia al
paciente y la inmutabilidad del historial de agrupación. No se elimina un episodio:
la apertura equivocada se documenta editando con motivo, sin borrar el historial.
Listas e historial se paginan de 20. Los conteos provienen de toda la base y
separan versiones de atenciones activas y pendientes de confirmación.

## Catálogos y plantillas

Migración 20260907160000_clinical_catalogs: servicios/especialidades compartidos,
opciones iniciales no clínicas y campo specialty opcional en las atenciones.
GET clinical-catalogs es autenticado, paginado de 20 y admite kind, status y q.
POST/PATCH requieren catalogs.manage (administrador base; configurable por rol).
Código/tipo son estables; nombre/disponibilidad requieren CAS. La normalización
impide duplicar nombres por mayúsculas o tildes. No hay borrado de opciones.

Servicio y especialidad se conservan como texto histórico en cada atención.
Los catálogos son sugerencias: un original externo puede consignar otro nombre.
Renombrar/desactivar no reescribe registros, borradores ni documentos existentes.

Las siete plantillas v1 se amplían aditivamente con campos opcionales de orientación,
destino, método/condición de muestra/comunicación crítica, verificaciones de seguridad,
materiales/destino de muestras, duración/tolerancia de terapia y destinatario/finalidad.
La duración admite minutos enteros de 1 a 1440. La ausencia no afirma normalidad.
No se calculan pautas, no se verifican interacciones ni se envían alertas críticas
automáticas por registrar una comunicación. Detalle, corrección y exportación
conservan los campos. La huella de confirmación incluye specialty cuando existe,
sin cambiar la huella de registros anteriores que carecen de ese campo.

## Búsqueda, indicadores, pendientes y exportación

GET patients/:id/clinical-history/search consulta toda la historia en PostgreSQL,
con páginas de 20 y total filtrado consistente por petición. Admite q, kind,
recordType, status, confirmation, from/to, episodeId y versions. Busca texto,
campos tipados y procedencia; el contenido documental solo se busca si está
VALIDATED. Los filtros se combinan y el texto no depende de tildes españolas.
Los valores se parametrizan y las búsquedas se auditan sin guardar el texto buscado.
Lectura: patients.read más records.read o documents.read; cada fuente y su conteo
se restringen al permiso correspondiente. Fechas civiles válidas en Lima, períodos
documentales por solapamiento y fechas desconocidas excluidas al filtrar por fecha.
Los archivos sin fecha solo usan carga como orden alternativo explícito.

GET patients/:id/clinical-history/overview calcula los indicadores sobre toda la
base: versiones, atenciones vigentes, confirmaciones pendientes, documentos,
validados, pendientes y episodios abiertos. Un indicador sin permiso es null,
no cero. No se infiere fecha clínica a partir de una carga. Listas y conteos usan
RepeatableRead; navegar páginas distintas no equivale a una instantánea congelada.

GET clinical-work ofrece pendientes actuales personales (20 por página; hasta
50): atenciones creadas por el usuario o a su cargo sin confirmación, originales
asignados pendientes de revisar y borradores propios sin vencer. Exige permisos
de lectura y acción de cada tipo, y paciente activo. La lista se calcula en vivo;
no persiste copias de contenido clínico ni crea notificaciones duplicadas. No se
marca una tarea como resuelta leyendo una notificación. Recargar actualiza el estado.

GET patients/:id/clinical-history/export conserva la exportación completa por
defecto. Opcionales from/to, episodeId y versions=CURRENT generan un alcance
FILTERED declarado. La selección parte de la instantánea completa del servidor,
no de páginas del navegador. Incluye contexto longitudinal e historial completo
de episodios seleccionados como antecedentes explícitos. Conserva originales
citados incluso fuera del período/sin fecha/no vigentes, siempre sin exportar texto
documental no validado. No duplica originales por múltiples citas. Un episodio
ajeno/no encontrado devuelve 404; un rango invertido, 400. La versión completa
incluye corregidos/anulados y todos los estados documentales sin reinterpretarlos.

Verificado: 418 pruebas unitarias y 26 E2E en PostgreSQL aislado, incluidos más de
60 registros, coincidencias antiguas, fechas, permisos por fuente, selección de
episodio, originales fuera del período, pendientes propios y ausencia de PHI en
auditoría. No se requiere otra migración para este bloque.

## Exclusión expresa

El punto 6 (seguridad/infraestructura de despliegue, MFA y alcance institucional)
se pospone por instrucción del usuario. No se modificó ni ejecutó el repositorio
de IA. Esta entrega funcional no acredita preparación legal o técnica para nube.

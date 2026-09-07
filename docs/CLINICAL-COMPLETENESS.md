# Completar los módulos clínicos

## Bloque 1: contexto del paciente e información longitudinal

- Identificación institucional opcional y única; contacto de emergencia,
  representante y seguro. No se asignan números ni antecedentes ficticios.
- Edición, activación y desactivación requieren `expectedVersion`; se guarda el
  actor y se devuelve `409` cuando otra sesión ya modificó al paciente.
- `GET/PUT /patients/:patientId/clinical-summary`: reconciliación explícita de
  alergias, problemas y medicación. Desconocido no equivale a ausencia declarada.
- Lectura: `patients.read` + `records.read`. Escritura: además `records.create`.
  No se expone contenido clínico a un rol que solo puede consultar filiación.
- Revisiones append-only con autor, fecha, motivo y payload validado. Las
  actualizaciones son transaccionales y no admiten pacientes inactivos.
- `GET .../clinical-summary/history`: páginas de 20 con `beforeVersion`.
- La exportación completa incluye todas las revisiones (la más reciente primero)
  dentro de la misma instantánea consistente que los documentos y atenciones.
- Auditoría operacional registra la acción y el actor, no el contenido clínico.

Aplicar `npm run prisma:migrate:deploy` y regenerar Prisma antes de iniciar esta
versión. Desplegar coordinadamente con el frontend que envía `expectedVersion`.

## Estado de los bloques del alcance aprobado

1. Metadatos clínicos, fecha/rango, procedencia y confirmación de carga: completado en el bloque 2.
2. Publicación humana de un documento validado como registro digitalizado enlazado: completado.
3. Autoría profesional, finalización y episodios; diferenciar atestación de firma
   digital certificada (esta última requiere una integración real): completado el cierre interno y los episodios.
4. Catálogos institucionales y ampliación discriminada de plantillas: completado.
5. Filtros, paginación completa, indicadores, pendientes y exportación avanzada: completado; ver CLINICAL-WORKFLOW.md.
6. Pospuesto expresamente: seguridad de despliegue, MFA y alcance institucional/paciente. Una publicación
   real en nube requiere elegir infraestructura y configurar sus credenciales;
   no queda implícitamente autorizada una contratación ni acreditación legal.

IA fuera del alcance. No se infieren diagnósticos, alergias ni tratamientos.

## Navegación del historial

`GET /patients/:patientId/records?status=ALL` incluye activos, corregidos y anulados.
Omitir `status` conserva el contrato anterior (solo activos). Antes, la opción
«Todos los estados» del frontend omitía el filtro y no mostraba realmente todos.
El orden de páginas de registros y documentos incorpora `id` como desempate de
fechas iguales. Se mantienen permisos, límites y aislamiento por paciente.

La ficha permite cargar páginas sucesivas, informa cobertura parcial y ofrece
filtros locales explícitos. Esto no convierte la consulta paginada en una
instantánea: ante cambios concurrentes se puede recargar. La exportación completa
conserva su transacción de instantánea independiente. La nueva ruta clinical-history/search
consulta toda la historia del paciente desde el servidor; los filtros locales de
la ficha siguen identificados como filtros de contenido cargado.

## Bloque 2: fechas clínicas y procedencia documental

La carga admite tipo documental, fecha civil o período, institución, servicio,
profesional original, páginas declaradas y observaciones. Los campos desconocidos
permanecen vacíos. Se validan fechas reales/no futuras, orden del período y límites.

`PATCH /patients/:patientId/documents/:documentId/metadata` requiere versión,
motivo y permisos de paciente, lectura documental y validación. Se respeta la
asignación a otro revisor. La transacción conserva la identificación anterior y
la nueva, con actor y motivo. El historial tiene cursor y páginas de 20; la
exportación completa contiene todas las revisiones sin paginar.

La migración `20260907110000_document_clinical_metadata` también impide `UPDATE`
y `DELETE` de ambas tablas de revisiones clínicas mediante triggers. Los cambios
se representan agregando una nueva revisión, no reemplazando las anteriores.

`npm run gen:openapi` genera `openapi.generated.json` sin iniciar un servidor ni
leer pacientes. El frontend puede regenerar contratos con `npm run gen-types:local`
cuando ambos repositorios están en carpetas hermanas. No usa credenciales reales.

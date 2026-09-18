# Identidad de responsables en la exportación clínica

La respuesta de `GET /patients/:id/clinical-history/export` agrega a cada
documento cuatro objetos opcionales, sin retirar ni reinterpretar los IDs:

| Objeto nuevo | ID histórico conservado | Acción atribuida |
| --- | --- | --- |
| `createdByActor` | `createdBy` | Registro/carga del documento |
| `correctedByActor` | `correctedById` | Corrección registrada |
| `reviewedByActor` | `reviewedBy` | Revisión registrada |
| `updatedByActor` | `updatedBy` | Última actualización registrada |

Cada objeto contiene `id`, `fullName`, `username`, `isActive`, `displayName` e
`identitySource`. Los nombres y usernames proceden del **directorio actual**
(`CURRENT_DIRECTORY`): no son snapshots del nombre en la fecha de la acción.
Las cuentas inactivas siguen siendo legibles y devuelven `isActive: false`.
No se filtran por roles ni se exige que estén activas para consultar su autoría.

Si no hay ID o no existe la cuenta, el ID original se conserva, los datos del
directorio son `null`, `identitySource` es `UNAVAILABLE` y `displayName` indica
`Autor histórico no registrado`. Nunca se atribuye la acción al exportador, al
profesional mencionado en la historia ni a un usuario de sustitución.

La interfaz puede mostrar nombre, `@username` e ID. Debe tolerar la ausencia de
los objetos nuevos al leer respuestas de versiones anteriores. `displayName`
no incluye el username si existe nombre completo; si solo existe username, usa
`@username`, para no confundir un identificador de cuenta con un nombre personal.

Esta identidad no acredita profesión, firma clínica ni el método de corrección
(manual/asistido por IA). Por tanto, `textSource: CORRECTED` significa **texto
corregido**, no «corrección profesional» ni garantía de exactitud. Los controles
de validación y el enmascaramiento de texto no validado permanecen intactos.

Los cuatro conjuntos de IDs se deduplican y resuelven mediante una única consulta
de usuarios dentro de la transacción `RepeatableRead` de la exportación. Sin IDs
no se consulta el directorio. No se exponen correo, documentos de identidad,
credenciales, profesión o roles. No hay migraciones ni cambios de datos.

Pruebas: resolución por lote, ausencia de N+1, conservación de IDs, cuentas
inactivas, nombres vacíos, actores desconocidos y ausencia del mapa interno en
los datos del paciente; cobertura previa de texto clínico validado y alcance.

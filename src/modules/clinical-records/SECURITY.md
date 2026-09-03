# SECURITY.md — clinical-records/

## Datos sensibles

Los registros, borradores e imágenes contienen información clínica protegida. Los binarios se
guardan en almacenamiento privado; ninguna respuesta expone `storagePath` ni contenido en base64.

## Control de acceso

- Lectura de registros, metadata y contenido adjunto: permiso `records.read`.
- Creación, carga y eliminación de temporales: permiso `records.create`.
- Corrección y anulación: permisos específicos de registros y control de versión CAS.
- Todas las operaciones requieren actor autenticado y verifican el `patientId` de la ruta.
- Un asset temporal solo es visible y eliminable por quien lo subió; un asset adjunto nunca se
  elimina físicamente al corregir u omitir una imagen.

## Archivos clínicos

Solo se aceptan JPEG/PNG estáticos reales. Se decodifican, autorrotan y recodifican para retirar
EXIF/GPS. Se aplican límites de 10 MiB por archivo, 25 MP, 10 adjuntos y 30 MiB agregados. Los
temporales expiran a los siete días y su eliminación usa CAS antes de limpiar storage.

## Logging y auditoría

Nunca registrar contenido clínico, nombres originales, captions, texto alternativo, rutas privadas
ni bytes. Los eventos de carga, enlace, borrado y purga contienen solo identificadores opacos,
actor, tipo MIME, tamaño, dimensiones y códigos de error acotados.

## Checklist

- [ ] Permiso requerido.
- [ ] Actor y paciente validados.
- [ ] Sin PHI/binarios/rutas en logs o JSON.
- [ ] Versionado y CAS donde corresponda.
- [ ] Procedencia y correcciones trazables.

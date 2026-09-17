# backend/test/

## Ejecución segura

`npm run test:e2e` exige `E2E_DATABASE_URL` de forma explícita. Debe apuntar a una base
distinta de `clinicview_dev` e incluir exactamente `?schema=clinicview_e2e`. El setup y el
teardown eliminan exclusivamente ese esquema literal; no existe fallback a `DATABASE_URL`.

```powershell
$env:E2E_DATABASE_URL = 'postgresql://postgres:clave@127.0.0.1:5432/clinicview_test?schema=clinicview_e2e'
npm run test:e2e
```

Pruebas **end-to-end** del backend (NestJS e2e). Las pruebas unit/integration viven junto a cada mÃ³dulo
(`modules/<modulo>/tests/`).

## Contiene
- `*.e2e-spec.ts` â€” flujos completos sobre la app levantada (con DB de prueba).
- `jest-e2e.json` â€” configuraciÃ³n e2e.
- `fixtures/` â€” datos sintÃ©ticos (NUNCA reales).

## Flujos e2e prioritarios (MVP)
- Login + RBAC (acceso por rol).
- Subida de documento â†’ procesamiento (mock de `AiClient`) â†’ revisiÃ³n â†’ validaciÃ³n â†’ aparece en historial.
- Registro manual â†’ validaciÃ³n â†’ aparece en historial.
- Carga de archivos: validaciÃ³n de tipo/tamaÃ±o/MIME.

## Cobertura clínica integral

`clinical-integrity.e2e-spec.ts` ejecuta contra la aplicación HTTP real y PostgreSQL aislado:

- alta de paciente y borradores privados con CAS, consumo atómico y TTL;
- los siete tipos de registro y validación discriminada de `details`;
- media clínica temporal, contenido privado, eliminación CAS y asociación transaccional;
- correcciones/anulaciones con conflictos de versión;
- PDF/JPEG/PNG por firma real, procesamiento con `IaClientService` mockeado y carrera
  `validate` vs. `reject`;
- exportación completa de más de 50 registros, todos los estados y adjuntos;
- autorización 401/403, rollback y ausencia de sentinelas PHI en auditoría.

## Reglas
- En las suites Jest, mockear `core/ia` y `integrations/rpa` (no llamar modelos
  externos). La aceptación de navegador descrita abajo utiliza el cliente HTTP
  de IA real contra un doble local controlado, sin sustituir servicios de Nest.
- Datos sintÃ©ticos. Base de datos efÃ­mera por corrida.

Ver `docs/` y los `TESTING.md` de cada mÃ³dulo para detalle.

## Aceptación de navegador hasta el PDF

El runner de navegador del frontend utiliza `scripts/browser-e2e-server.cjs`. Este arnés
levanta **Nest real desde el código fuente** con `ts-node` en `127.0.0.1:3101`; no recompila
`dist`, no sustituye guards ni servicios, y no reinicia el backend local de desarrollo.
Autenticación, RBAC, persistencia, trabajos OCR, revisión, publicación y exportación usan
los módulos de la aplicación. Únicamente el límite HTTP de IA es un doble controlado,
por lo que esta prueba verifica integración y contenido exportado, **no precisión OCR**.

Protecciones y contrato:

- `BROWSER_E2E_DATABASE_URL` es obligatoria, sin fallback a `DATABASE_URL`. Solo acepta
  PostgreSQL en `localhost`/`127.0.0.1:5433`, base `clinicview_test`, parámetro único
  `schema=clinicview_browser_e2e`. Rechaza hosts remotos, base de desarrollo, otro puerto,
  otro esquema y parámetros adicionales que podrían modificar la conexión/search path.
- Antes de reinicializar comprueba también la identidad real de la base y su puerto.
  El SQL de reinicio es un literal limitado a `clinicview_browser_e2e`; nunca interpola
  una entrada del usuario. No afecta `public` ni `clinicview_e2e`.
- Mantiene un advisory lock PostgreSQL durante toda la ejecución para excluir otra
  corrida, y comprueba/reserva el puerto antes de reinicializar. El esquema queda
  retenido al finalizar para diagnóstico y se reinicia en la siguiente corrida válida.
- `BROWSER_E2E_RUN_DIR` debe ser una carpeta absoluta nueva `clinicview-browser-e2e-*`.
  Recibe `uploads/`, `backend-manifest.json` privado y, si falla, un diagnóstico privado.
  Nunca elimina directorios de disco ni reutiliza el almacenamiento de desarrollo.
- `FRONTEND_URL=http://localhost:3110`, `IA_INTERNAL_URL=http://127.0.0.1:8100` y una
  `IA_INTERNAL_API_KEY` nueva de al menos 32 caracteres son obligatorios.
- El seed reutiliza los roles/capacidades de producción y agrega un médico activo,
  lector con permisos restringidos, catálogos y paciente enteramente sintéticos. Cada
  corrida genera nuevas contraseñas; el manifest no debe imprimirse ni versionarse.
- El manifest contiene `{schemaVersion, ready, synthetic, pid, backendUrl, frontendUrl,
  createdAt, admin, doctor, reader, patient, catalogs}`. Cada identidad incluye
  `{id, email, username, fullName, password}`. Se escribe atómicamente después de iniciar
  HTTP; también se emite `{ready:true}` por IPC si el padre usa `fork`.
  `backendUrl=http://localhost:3101` conserva el mismo host que el navegador para probar
  la cookie SameSite real; el listener permanece restringido a `127.0.0.1`.
- El padre debe enviar `shutdown` por IPC al acabar: cierra Nest, conexiones y lock.
  La desconexión del padre también activa ese cierre. Se admiten `SIGINT`/`SIGTERM`.

Pruebas del arnés, independientes de la suite del navegador:

```powershell
node --test scripts/browser-e2e-safety.test.cjs
$env:BROWSER_E2E_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/clinicview_test?schema=clinicview_browser_e2e'
node --test scripts/browser-e2e-harness.test.cjs
```

La segunda exige PostgreSQL disponible y **reinicializa únicamente el esquema de
navegador indicado**. Comprueba arranque, seed, health, login, autorización 401/403 y
cierre IPC; conserva sus artefactos sintéticos en el directorio temporal para revisión.
No hace falta levantar el modelo de IA para esta prueba del arnés.



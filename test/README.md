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
- Mockear `core/ia` y `integrations/rpa` en e2e (no llamar servicios reales).
- Datos sintÃ©ticos. Base de datos efÃ­mera por corrida.

Ver `docs/` y los `TESTING.md` de cada mÃ³dulo para detalle.



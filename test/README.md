# backend/test/

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

## Reglas
- Mockear `core/ia` y `integrations/rpa` en e2e (no llamar servicios reales).
- Datos sintÃ©ticos. Base de datos efÃ­mera por corrida.

Ver `docs/` y los `TESTING.md` de cada mÃ³dulo para detalle.



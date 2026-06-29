# CONTRACTS.md - Backend <-> IA

La fuente de verdad del contrato Backend <-> IA es:

`ia/CONTRACTS.md`

Este archivo se conserva como puntero desde el lado backend para evitar duplicados divergentes. El
cliente ejecutable actual del backend esta en `backend/src/core/ia/ia-client.service.ts`.

Regla: cualquier cambio funcional del contrato debe actualizar `ia/CONTRACTS.md` y luego revisar que
`backend/src/core/ia/ia-client.service.ts` siga cumpliendolo.

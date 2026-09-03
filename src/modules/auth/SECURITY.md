# SECURITY.md — auth/

## Contrato de sesión

- El access token se devuelve en JSON y vive brevemente en memoria del cliente.
- El refresh token nunca se devuelve en JSON: viaja exclusivamente en la cookie
  `clinicview_refresh_token`, `HttpOnly`, `SameSite=Strict`, `Path=/api/auth` y `Secure` en
  producción.
- `rememberMe=false` crea una cookie de sesión; `rememberMe=true` añade `Max-Age`.
- `POST /auth/refresh` rota el token de un solo uso. Un replay no crea otra sesión.
- `POST /auth/logout` es idempotente, revoca el hash si existe y siempre borra la cookie.

## Persistencia y revocación

Solo se persiste SHA-256 del refresh token. La creación y rotación usan transacciones
`Serializable`. Cambiar contraseña o rol y desactivar una cuenta incrementa `sessionVersion` y
elimina sus refresh tokens dentro de la misma transacción.

Cada request con access token vuelve a consultar usuario activo, `sessionVersion` y permisos
actuales. Los claims de permisos nunca son la fuente de autorización del servidor.

## Reglas operativas

- No registrar credenciales, cookies, tokens, hashes ni cuerpos de endpoints auth.
- Mantener secretos de access y refresh diferentes y de alta entropía.
- Servir producción exclusivamente por HTTPS; `Secure` impide la cookie sobre HTTP.
- Mantener CORS con origen explícito y `credentials: true`; no usar comodín.
- Login y refresh tienen rate limit específico.

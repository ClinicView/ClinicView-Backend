# SECURITY.md — auth/

## Datos sensibles
Credenciales, tokens. Nunca persistir tokens en claro ni loguearlos.

## Control de acceso
Endpoints públicos: `login`, `refresh`, `forgot-password`. El resto requiere `JwtAuthGuard`.

## Logging
Prohibido loguear contraseñas, tokens o el cuerpo de las peticiones de auth. Loguear solo `userId`
(opaco), resultado (éxito/fallo) y timestamp.

## Reglas
- Hash con bcrypt/argon2; sal por contraseña.
- Rotación/expiración de tokens. Refresh tokens revocables.
- Rate limiting y bloqueo tras N intentos.
- Cambios de contraseña y bloqueos se auditan.

## Checklist
- [ ] Hash fuerte. [ ] Rate limiting. [ ] Tokens expiran. [ ] Eventos auditados. [ ] Sin secretos en logs.

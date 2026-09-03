-- Los access tokens se invalidan al cambiar esta versión. El default conserva
-- usuarios existentes sin requerir backfill manual.
ALTER TABLE "users"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD CONSTRAINT "users_session_version_check" CHECK ("session_version" >= 0);

-- Los refresh tokens emitidos por la versión anterior podían viajar en JSON y
-- no incluían versión/tipo de sesión. Se revocan explícitamente durante el
-- despliegue para que el nuevo contrato sea exclusivamente HttpOnly cookie.
DELETE FROM "refresh_tokens";

DROP INDEX "refresh_tokens_user_id_idx";

ALTER TABLE "refresh_tokens"
  ADD COLUMN "session_version" INTEGER NOT NULL,
  ADD COLUMN "remember_me" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_session_version_check" CHECK ("session_version" >= 0);

CREATE INDEX "refresh_tokens_user_id_expires_at_idx"
  ON "refresh_tokens"("user_id", "expires_at");

CREATE INDEX "refresh_tokens_user_id_session_version_idx"
  ON "refresh_tokens"("user_id", "session_version");

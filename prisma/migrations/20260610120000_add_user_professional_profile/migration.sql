ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN "last_name" TEXT;
ALTER TABLE "users" ADD COLUMN "document_type" "DocumentType";
ALTER TABLE "users" ADD COLUMN "document_number" TEXT;
ALTER TABLE "users" ADD COLUMN "profession" TEXT;

UPDATE "users"
SET
  "first_name" = COALESCE(NULLIF(split_part("full_name", ' ', 1), ''), 'Usuario'),
  "last_name" = COALESCE(
    NULLIF(trim(substr("full_name", length(split_part("full_name", ' ', 1)) + 1)), ''),
    'Sistema'
  ),
  "username" = COALESCE(
    NULLIF(lower(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), ''),
    'usuario'
  ) || '_' || substr(replace("id"::text, '-', ''), 1, 6)
WHERE "first_name" IS NULL
   OR "last_name" IS NULL
   OR "username" IS NULL;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "last_name" SET NOT NULL;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_document_number_key" ON "users"("document_number");

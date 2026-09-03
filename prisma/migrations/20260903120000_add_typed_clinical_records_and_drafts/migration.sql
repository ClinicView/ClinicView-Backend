-- Typed, versioned payload for clinical records. Existing rows remain valid
-- with an empty v1 payload until they are corrected using a typed template.
ALTER TABLE "clinical_records"
  ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "professional_id" UUID,
  ADD COLUMN "professional_name_snapshot" TEXT,
  ADD COLUMN "professional_license_snapshot" TEXT;

ALTER TABLE "clinical_records"
  ADD CONSTRAINT "clinical_records_professional_id_fkey"
  FOREIGN KEY ("professional_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clinical_records_professional_id_idx"
  ON "clinical_records"("professional_id");

-- Secure server-side drafts. There is at most one current draft per actor and
-- patient; optimistic versioning prevents one tab from overwriting another.
CREATE TABLE "clinical_record_drafts" (
  "id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "clinical_record_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_record_drafts_patient_id_actor_id_key"
  ON "clinical_record_drafts"("patient_id", "actor_id");
CREATE INDEX "clinical_record_drafts_actor_id_expires_at_idx"
  ON "clinical_record_drafts"("actor_id", "expires_at");
CREATE INDEX "clinical_record_drafts_expires_at_idx"
  ON "clinical_record_drafts"("expires_at");

ALTER TABLE "clinical_record_drafts"
  ADD CONSTRAINT "clinical_record_drafts_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_record_drafts"
  ADD CONSTRAINT "clinical_record_drafts_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

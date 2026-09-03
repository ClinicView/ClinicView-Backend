CREATE TABLE "patient_registration_drafts" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_registration_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_registration_drafts_actor_id_key"
ON "patient_registration_drafts"("actor_id");

CREATE INDEX "patient_registration_drafts_expires_at_idx"
ON "patient_registration_drafts"("expires_at");

ALTER TABLE "patient_registration_drafts"
ADD CONSTRAINT "patient_registration_drafts_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "ClinicalMediaStatus" AS ENUM ('TEMPORARY', 'ATTACHED');

CREATE TABLE "clinical_media_assets" (
  "id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "original_name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "status" "ClinicalMediaStatus" NOT NULL DEFAULT 'TEMPORARY',
  "expires_at" TIMESTAMPTZ,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "clinical_media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clinical_media_assets_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
  CONSTRAINT "clinical_media_assets_dimensions_check" CHECK (
    "width" > 0 AND "height" > 0 AND
    "width" <= 10000 AND "height" <= 10000 AND
    ("width"::BIGINT * "height"::BIGINT) <= 25000000
  ),
  CONSTRAINT "clinical_media_assets_mime_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png')),
  CONSTRAINT "clinical_media_assets_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "clinical_media_assets_expiration_check" CHECK (
    ("status" = 'TEMPORARY' AND "expires_at" IS NOT NULL) OR
    ("status" = 'ATTACHED' AND "expires_at" IS NULL)
  )
);

CREATE TABLE "clinical_record_attachments" (
  "id" UUID NOT NULL,
  "clinical_record_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "section_key" TEXT,
  "caption" TEXT,
  "alt_text" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_record_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clinical_record_attachments_sort_order_check" CHECK ("sort_order" >= 0 AND "sort_order" <= 9)
);

CREATE UNIQUE INDEX "clinical_media_assets_storage_path_key"
  ON "clinical_media_assets"("storage_path");
CREATE INDEX "clinical_media_assets_patient_id_status_idx"
  ON "clinical_media_assets"("patient_id", "status");
CREATE INDEX "clinical_media_assets_uploaded_by_status_expires_at_idx"
  ON "clinical_media_assets"("uploaded_by", "status", "expires_at");
CREATE INDEX "clinical_media_assets_status_expires_at_idx"
  ON "clinical_media_assets"("status", "expires_at");

CREATE UNIQUE INDEX "clinical_record_attachments_clinical_record_id_asset_id_key"
  ON "clinical_record_attachments"("clinical_record_id", "asset_id");
CREATE INDEX "clinical_record_attachments_clinical_record_id_sort_order_created_at_idx"
  ON "clinical_record_attachments"("clinical_record_id", "sort_order", "created_at");
CREATE INDEX "clinical_record_attachments_asset_id_idx"
  ON "clinical_record_attachments"("asset_id");

ALTER TABLE "clinical_media_assets"
  ADD CONSTRAINT "clinical_media_assets_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_media_assets"
  ADD CONSTRAINT "clinical_media_assets_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_record_attachments"
  ADD CONSTRAINT "clinical_record_attachments_clinical_record_id_fkey"
  FOREIGN KEY ("clinical_record_id") REFERENCES "clinical_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_record_attachments"
  ADD CONSTRAINT "clinical_record_attachments_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "clinical_media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_record_attachments"
  ADD CONSTRAINT "clinical_record_attachments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

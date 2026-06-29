ALTER TABLE "medical_documents"
  ADD COLUMN "corrected_text" TEXT,
  ADD COLUMN "corrected_entities" JSONB,
  ADD COLUMN "corrected_at" TIMESTAMP(3),
  ADD COLUMN "corrected_by_id" UUID;

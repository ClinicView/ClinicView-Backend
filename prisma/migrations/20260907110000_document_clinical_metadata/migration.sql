ALTER TABLE "medical_documents" ADD COLUMN "clinical_metadata" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "document_metadata_revisions" (
  "id" UUID NOT NULL, "document_id" UUID NOT NULL, "version" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL, "reason" VARCHAR(500) NOT NULL,
  "recorded_by" UUID, "recorded_by_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_metadata_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_metadata_revisions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "medical_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "document_metadata_revisions_document_id_version_key" ON "document_metadata_revisions"("document_id", "version");

-- Prevent accidental changes to historical clinical revisions by future code.
CREATE FUNCTION prevent_clinical_context_revision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Clinical context revisions are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patient_clinical_summary_immutable
  BEFORE UPDATE OR DELETE ON "patient_clinical_summary_revisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_clinical_context_revision_mutation();
CREATE TRIGGER document_metadata_immutable
  BEFORE UPDATE OR DELETE ON "document_metadata_revisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_clinical_context_revision_mutation();

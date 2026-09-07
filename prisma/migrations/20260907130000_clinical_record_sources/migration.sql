ALTER TABLE "clinical_records" ADD COLUMN "attendance_precision" TEXT NOT NULL DEFAULT 'INSTANT',
  ADD COLUMN "created_by_name_snapshot" TEXT;
ALTER TABLE "clinical_records" ADD CONSTRAINT "record_attendance_precision_check" CHECK ("attendance_precision" IN ('INSTANT', 'DAY'));
CREATE TABLE "clinical_record_sources" (
  "id" UUID NOT NULL, "record_id" UUID NOT NULL, "document_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL, "document_name" TEXT NOT NULL,
  "document_metadata" JSONB NOT NULL, "page_from" INTEGER NOT NULL, "page_to" INTEGER NOT NULL,
  "source_note" VARCHAR(1000) NOT NULL, "publication_key" UUID,
  "published_by" UUID NOT NULL, "published_by_name" TEXT NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinical_record_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_pages_check" CHECK ("page_from" >= 1 AND "page_to" >= "page_from" AND "page_to" <= 5000),
  CONSTRAINT "source_record_fk" FOREIGN KEY ("record_id") REFERENCES "clinical_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_document_fk" FOREIGN KEY ("document_id") REFERENCES "medical_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "clinical_record_sources_record_id_key" ON "clinical_record_sources"("record_id");
CREATE UNIQUE INDEX "clinical_record_sources_publication_key_key" ON "clinical_record_sources"("publication_key");
CREATE INDEX "clinical_record_sources_document_id_idx" ON "clinical_record_sources"("document_id");
CREATE TRIGGER "clinical_record_sources_immutable" BEFORE UPDATE OR DELETE ON "clinical_record_sources"
FOR EACH ROW EXECUTE FUNCTION prevent_clinical_context_revision_mutation();

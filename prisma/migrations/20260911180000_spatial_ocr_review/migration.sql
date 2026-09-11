CREATE TABLE "document_ocr_runs" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "run_id" VARCHAR(120) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "machine_layout" JSONB NOT NULL,
    "page_images" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_ocr_runs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "document_ocr_review_revisions" (
    "id" UUID NOT NULL,
    "ocr_run_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "document_version" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "corrected_text" TEXT NOT NULL,
    "previous_correction" JSONB NOT NULL,
    "reason" VARCHAR(500),
    "recorded_by" UUID NOT NULL,
    "recorded_by_username" VARCHAR(50) NOT NULL,
    "recorded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_ocr_review_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_ocr_runs_document_id_run_id_key" ON "document_ocr_runs"("document_id", "run_id");
CREATE INDEX "document_ocr_runs_document_id_created_at_idx" ON "document_ocr_runs"("document_id", "created_at" DESC);
CREATE UNIQUE INDEX "document_ocr_review_revisions_ocr_run_id_revision_key" ON "document_ocr_review_revisions"("ocr_run_id", "revision");
ALTER TABLE "document_ocr_runs" ADD CONSTRAINT "document_ocr_runs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "medical_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_ocr_review_revisions" ADD CONSTRAINT "document_ocr_review_revisions_ocr_run_id_fkey" FOREIGN KEY ("ocr_run_id") REFERENCES "document_ocr_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clinical provenance must not be silently rewritten by another code path.
CREATE FUNCTION reject_ocr_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'OCR runs and spatial review revisions are append-only';
END;
$$;
CREATE TRIGGER document_ocr_runs_immutable BEFORE UPDATE OR DELETE ON "document_ocr_runs"
    FOR EACH ROW EXECUTE FUNCTION reject_ocr_history_mutation();
CREATE TRIGGER document_ocr_reviews_immutable BEFORE UPDATE OR DELETE ON "document_ocr_review_revisions"
    FOR EACH ROW EXECUTE FUNCTION reject_ocr_history_mutation();
CREATE TRIGGER document_ocr_runs_no_truncate BEFORE TRUNCATE ON "document_ocr_runs"
    FOR EACH STATEMENT EXECUTE FUNCTION reject_ocr_history_mutation();
CREATE TRIGGER document_ocr_reviews_no_truncate BEFORE TRUNCATE ON "document_ocr_review_revisions"
    FOR EACH STATEMENT EXECUTE FUNCTION reject_ocr_history_mutation();

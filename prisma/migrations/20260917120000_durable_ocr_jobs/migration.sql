CREATE TABLE "document_processing_jobs" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "source_sha256" VARCHAR(64) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3),
  "status" VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
  "progress" JSONB NOT NULL,
  "error" JSONB,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "heartbeat_at" TIMESTAMPTZ(3),
  "processing_run_id" UUID,
  "next_poll_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_until" TIMESTAMPTZ(3),
  CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_processing_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "medical_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "document_processing_jobs_attempt_check" CHECK ("attempt" > 0 AND "document_version" > 0),
  CONSTRAINT "document_processing_jobs_state_check" CHECK ("status" IN ('QUEUED','RUNNING','WAITING_FOR_WORKER','FINALIZING','SUCCEEDED','FAILED','INTERRUPTED'))
);
CREATE UNIQUE INDEX "document_processing_jobs_document_id_attempt_key" ON "document_processing_jobs"("document_id", "attempt");
CREATE INDEX "document_processing_jobs_status_next_poll_at_idx" ON "document_processing_jobs"("status", "next_poll_at");
-- Additive only: existing OCR runs, reviews and clinical documents are not rewritten.

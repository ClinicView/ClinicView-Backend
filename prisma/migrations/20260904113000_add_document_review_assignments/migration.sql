CREATE TYPE "ReviewPriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'LOW');

ALTER TABLE "medical_documents"
ADD COLUMN "review_priority" "ReviewPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "assigned_reviewer_id" UUID,
ADD COLUMN "assigned_at" TIMESTAMPTZ(3);

ALTER TABLE "medical_documents"
ADD CONSTRAINT "medical_documents_assigned_reviewer_id_fkey"
FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "medical_documents"
ADD CONSTRAINT "medical_documents_assignment_consistency_check"
CHECK (
  ("assigned_reviewer_id" IS NULL AND "assigned_at" IS NULL)
  OR ("assigned_reviewer_id" IS NOT NULL AND "assigned_at" IS NOT NULL)
);

CREATE INDEX "medical_documents_status_review_priority_processed_at_idx"
ON "medical_documents"("status", "review_priority", "processed_at");

CREATE INDEX "medical_documents_assigned_reviewer_id_status_idx"
ON "medical_documents"("assigned_reviewer_id", "status");

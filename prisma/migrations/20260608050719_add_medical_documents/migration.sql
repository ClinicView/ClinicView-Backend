-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'VALIDATED', 'REJECTED');

-- CreateTable
CREATE TABLE "medical_documents" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "ocr_text" TEXT,
    "ner_entities" JSONB,
    "reject_reason" TEXT,
    "processed_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "medical_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medical_documents_patient_id_created_at_idx" ON "medical_documents"("patient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "medical_documents_status_idx" ON "medical_documents"("status");

-- AddForeignKey
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

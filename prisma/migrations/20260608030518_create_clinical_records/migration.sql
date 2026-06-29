-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('CONSULTATION', 'LAB_RESULT', 'PRESCRIPTION', 'THERAPY_NOTE', 'EVOLUTION', 'PROCEDURE', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordOrigin" AS ENUM ('MANUAL', 'DIGITIZED');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'CORRECTED', 'VOIDED');

-- CreateTable
CREATE TABLE "clinical_records" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "record_type" "RecordType" NOT NULL,
    "origin" "RecordOrigin" NOT NULL DEFAULT 'MANUAL',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "attended_at" TIMESTAMPTZ NOT NULL,
    "summary" TEXT NOT NULL,
    "notes" TEXT,
    "parent_record_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "clinical_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_records_patient_id_attended_at_idx" ON "clinical_records"("patient_id", "attended_at" DESC);

-- CreateIndex
CREATE INDEX "clinical_records_patient_id_status_idx" ON "clinical_records"("patient_id", "status");

-- AddForeignKey
ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_parent_record_id_fkey" FOREIGN KEY ("parent_record_id") REFERENCES "clinical_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

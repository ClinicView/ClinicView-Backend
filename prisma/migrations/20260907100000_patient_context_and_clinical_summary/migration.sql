ALTER TABLE "patients"
  ADD COLUMN "medical_record_number" VARCHAR(50),
  ADD COLUMN "emergency_contact_name" VARCHAR(150),
  ADD COLUMN "emergency_contact_phone" VARCHAR(30),
  ADD COLUMN "emergency_contact_relationship" VARCHAR(80),
  ADD COLUMN "representative_name" VARCHAR(150),
  ADD COLUMN "insurance_name" VARCHAR(100),
  ADD COLUMN "insurance_number" VARCHAR(80);
CREATE UNIQUE INDEX "patients_medical_record_number_key" ON "patients"("medical_record_number");
CREATE TABLE "patient_clinical_summary_revisions" (
  "id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "recorded_by" UUID NOT NULL,
  "recorded_by_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_clinical_summary_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_clinical_summary_revisions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "patient_clinical_summary_revisions_patient_id_version_key" ON "patient_clinical_summary_revisions"("patient_id", "version");

-- Contexto clínico del registro manual de atención (rediseño julio 2026)
ALTER TABLE "clinical_records" ADD COLUMN "doctor_name" TEXT;
ALTER TABLE "clinical_records" ADD COLUMN "service" TEXT;
ALTER TABLE "clinical_records" ADD COLUMN "preliminary_diagnosis" TEXT;
ALTER TABLE "clinical_records" ADD COLUMN "plan" TEXT;
ALTER TABLE "clinical_records" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL';

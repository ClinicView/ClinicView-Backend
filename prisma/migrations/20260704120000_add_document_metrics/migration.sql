-- Métricas de calidad OCR/NER del servicio IA v2 (TrOCR)
ALTER TABLE "medical_documents" ADD COLUMN "metrics" JSONB;
ALTER TABLE "medical_documents" ADD COLUMN "ocr_confidence" DOUBLE PRECISION;
ALTER TABLE "medical_documents" ADD COLUMN "confidence_level" TEXT;

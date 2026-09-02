-- Conserva la atestación clínica que acompaña a la validación final.
-- validation_checklist contiene el snapshot JSON versionado de los textos aceptados.
-- Las columnas permanecen opcionales para documentos históricos ya validados.
ALTER TABLE "medical_documents"
    ADD COLUMN "validation_checklist" JSONB,
    ADD COLUMN "validation_attested" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "validation_attested_at" TIMESTAMP(3);

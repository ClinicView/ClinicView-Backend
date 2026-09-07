CREATE TABLE "clinical_record_confirmations" (
  "id" UUID PRIMARY KEY, "record_id" UUID NOT NULL UNIQUE,
  "record_version" INTEGER NOT NULL CHECK ("record_version" >= 0),
  "actor_id" UUID NOT NULL, "actor_name" TEXT NOT NULL, "actor_username" TEXT NOT NULL,
  "capacity" TEXT NOT NULL CHECK ("capacity" IN ('ORIGINAL_PROFESSIONAL', 'REVIEWER')),
  "note" VARCHAR(2000), "content_hash" CHAR(64) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("record_id") REFERENCES "clinical_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TRIGGER "record_confirmations_immutable" BEFORE UPDATE OR DELETE ON "clinical_record_confirmations"
FOR EACH ROW EXECUTE FUNCTION prevent_clinical_context_revision_mutation();

INSERT INTO "permissions" ("id", "key", "description", "created_at")
VALUES ('eccb8a90-cd46-4e80-821a-0a21ac99b680', 'records.confirm', 'Confirmar y cerrar una versión clínica revisada.', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" IN ('ADMINISTRADOR', 'MEDICO', 'LABORATORISTA', 'TERAPEUTA', 'FARMACEUTICO') AND p."key" = 'records.confirm'
ON CONFLICT DO NOTHING;

CREATE FUNCTION check_clinical_source_patient() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clinical_records r JOIN medical_documents d ON d.patient_id = r.patient_id
    WHERE r.id = NEW.record_id AND d.id = NEW.document_id) THEN
    RAISE EXCEPTION 'Clinical source and record must belong to the same patient';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clinical_source_patient BEFORE INSERT ON clinical_record_sources
FOR EACH ROW EXECUTE FUNCTION check_clinical_source_patient();

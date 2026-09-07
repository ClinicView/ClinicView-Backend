ALTER TABLE clinical_records ADD COLUMN specialty VARCHAR(120);
CREATE TABLE clinical_catalog_entries (
 id UUID PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('SERVICE', 'SPECIALTY')),
 code VARCHAR(40) NOT NULL, name VARCHAR(120) NOT NULL, normalized_name VARCHAR(120) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT true, version INTEGER NOT NULL DEFAULT 0,
 updated_by UUID, updated_at TIMESTAMPTZ(3) NOT NULL,
 UNIQUE(kind, code), UNIQUE(kind, normalized_name)
);
INSERT INTO clinical_catalog_entries (id, kind, code, name, normalized_name, updated_at)
SELECT md5('clinicview/catalog/' || kind || '/' || code)::uuid, kind, code, name, normalized, CURRENT_TIMESTAMP
FROM (VALUES
 ('SERVICE','CONS_EXT','Consulta externa','consulta externa'),
 ('SERVICE','LAB','Laboratorio','laboratorio'),
 ('SERVICE','PROC','Procedimientos','procedimientos'),
 ('SERVICE','REHAB','Rehabilitación','rehabilitacion'),
 ('SPECIALTY','MED_GEN','Medicina General','medicina general'),
 ('SPECIALTY','MED_INT','Medicina Interna','medicina interna'),
 ('SPECIALTY','CARD','Cardiología','cardiologia'),
 ('SPECIALTY','PED','Pediatría','pediatria'),
 ('SPECIALTY','GYN','Ginecología y Obstetricia','ginecologia y obstetricia'),
 ('SPECIALTY','TRAUM','Traumatología','traumatologia'),
 ('SPECIALTY','NEURO','Neurología','neurologia'),
 ('SPECIALTY','DERM','Dermatología','dermatologia'),
 ('SPECIALTY','PSIQ','Psiquiatría','psiquiatria')
) AS entries(kind, code, name, normalized);
INSERT INTO permissions (id, key, description, created_at)
VALUES ('21e59ea4-e426-4c1c-a01c-86bb1a3379b6', 'catalogs.manage', 'Administrar servicios y especialidades institucionales.', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.key = 'ADMINISTRADOR' AND p.key = 'catalogs.manage'
ON CONFLICT DO NOTHING;

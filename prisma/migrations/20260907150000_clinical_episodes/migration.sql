CREATE TABLE clinical_episodes (
 id UUID PRIMARY KEY, patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 title VARCHAR(180) NOT NULL, description VARCHAR(2000), started_on DATE NOT NULL, ended_on DATE,
 status TEXT NOT NULL DEFAULT 'OPEN', version INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT episode_dates_check CHECK (ended_on IS NULL OR ended_on >= started_on),
 CONSTRAINT episode_status_check CHECK ((status = 'OPEN' AND ended_on IS NULL) OR (status = 'CLOSED' AND ended_on IS NOT NULL))
);
CREATE INDEX clinical_episodes_patient_id_started_on_id_idx ON clinical_episodes(patient_id, started_on DESC, id);
ALTER TABLE clinical_records ADD COLUMN episode_id UUID REFERENCES clinical_episodes(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX clinical_records_episode_id_status_idx ON clinical_records(episode_id, status);
CREATE TABLE clinical_episode_events (
 id UUID PRIMARY KEY, episode_id UUID NOT NULL REFERENCES clinical_episodes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 record_id UUID, action TEXT NOT NULL, actor_id UUID NOT NULL, actor_name TEXT NOT NULL,
 reason VARCHAR(2000) NOT NULL, payload JSONB NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX clinical_episode_events_episode_id_created_at_id_idx ON clinical_episode_events(episode_id, created_at DESC, id);
CREATE TRIGGER clinical_episode_events_immutable BEFORE UPDATE OR DELETE ON clinical_episode_events
FOR EACH ROW EXECUTE FUNCTION prevent_clinical_context_revision_mutation();
CREATE FUNCTION check_record_episode_patient() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.episode_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clinical_episodes e WHERE e.id = NEW.episode_id AND e.patient_id = NEW.patient_id) THEN
  RAISE EXCEPTION 'Episode and record must belong to the same patient';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER record_episode_patient BEFORE INSERT OR UPDATE OF episode_id, patient_id ON clinical_records
FOR EACH ROW EXECUTE FUNCTION check_record_episode_patient();

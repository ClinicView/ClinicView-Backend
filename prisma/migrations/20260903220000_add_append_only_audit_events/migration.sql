CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" VARCHAR(64) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "actor_id" UUID,
    "patient_id" UUID,
    "resource_type" VARCHAR(32),
    "resource_id" UUID,
    "request_id" UUID NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "route" VARCHAR(160) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ip_hash" CHAR(64),
    "user_agent_hash" CHAR(64),

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_action_not_empty" CHECK (length(trim("action")) > 0),
    CONSTRAINT "audit_events_status_code_range" CHECK ("status_code" BETWEEN 100 AND 599),
    CONSTRAINT "audit_events_duration_non_negative" CHECK ("duration_ms" >= 0)
);

CREATE INDEX "audit_events_occurred_at_id_idx"
ON "audit_events"("occurred_at" DESC, "id" DESC);
CREATE INDEX "audit_events_actor_id_occurred_at_idx"
ON "audit_events"("actor_id", "occurred_at" DESC);
CREATE INDEX "audit_events_patient_id_occurred_at_idx"
ON "audit_events"("patient_id", "occurred_at" DESC);
CREATE INDEX "audit_events_action_outcome_occurred_at_idx"
ON "audit_events"("action", "outcome", "occurred_at" DESC);
CREATE INDEX "audit_events_request_id_idx" ON "audit_events"("request_id");

ALTER TABLE "audit_events"
ADD CONSTRAINT "audit_events_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_audit_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_reject_update_delete"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_event_mutation"();

CREATE TRIGGER "audit_events_reject_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_audit_event_mutation"();

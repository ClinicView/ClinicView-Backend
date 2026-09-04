-- Snapshot mínimo de identidad para conservar quién ejecutó la acción
-- aunque su username institucional cambie posteriormente.
ALTER TABLE "audit_events"
ADD COLUMN "actor_username_at_event" VARCHAR(50);

ALTER TABLE "audit_events"
ADD CONSTRAINT "audit_events_actor_username_snapshot_format"
CHECK (
  "actor_username_at_event" IS NULL
  OR "actor_username_at_event" ~ '^[A-Za-z0-9._-]{3,50}$'
);

CREATE INDEX "audit_events_actor_username_at_event_occurred_at_idx"
ON "audit_events"("actor_username_at_event", "occurred_at" DESC);

-- The General Manager's daily targets: one per person per day, what the records showed
-- afterwards, and whether the person was told (lib/exec.js). Also created at runtime by
-- ensureExecSchema(), so a missed "Run schema migration" does not stop the morning brief.
CREATE TABLE IF NOT EXISTS manager_assignments (
  id          serial PRIMARY KEY,
  day         date NOT NULL,
  person_name text NOT NULL,
  person_email text,
  metric      text NOT NULL,
  target      integer NOT NULL,
  why         text,
  actual      integer,
  status      text,                    -- NULL until judged: met | short | nothing | off
  judged_at   timestamptz,
  texted_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_assignments ON manager_assignments (day, lower(person_name), metric);
CREATE INDEX IF NOT EXISTS idx_manager_assignments_day ON manager_assignments (day DESC);

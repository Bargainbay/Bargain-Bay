-- Who changed what. Append-only: a log that can be edited cannot answer "who changed
-- this price" and is worse than no log, because it looks like an answer.
--
-- Written by lib/audit.js from the SIGNED-IN session, never from a request body.
-- `entity_id` is text because the things logged carry different keys (an invoice
-- number, a SKU, a coupon id). `detail` holds the before/after where it is cheap.

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL,
  actor_name  text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  summary     text,
  detail      jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor);

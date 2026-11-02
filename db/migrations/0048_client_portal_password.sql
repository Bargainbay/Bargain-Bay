-- A client's delivery portal asks for a password the office sets per client.
-- The hash is never sent to a browser; failed attempts are counted in a table
-- (not memory) so the lockout holds across serverless instances.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_password_hash text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_password_set_at timestamptz;

CREATE TABLE IF NOT EXISTS client_portal_attempts (
  id serial PRIMARY KEY,
  client_id int NOT NULL,
  ip text,
  ok boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_portal_attempts ON client_portal_attempts(client_id, at);

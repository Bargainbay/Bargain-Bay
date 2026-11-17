-- The Manager team (owner, 2026-11-17): a General Manager plus a Delivery and a Sales
-- manager that report to it, answered on the phone at any time, and a log of the
-- e-transfers the Manager read from the service mailbox.
ALTER TABLE manager_calls ADD COLUMN IF NOT EXISTS dept text NOT NULL DEFAULT 'gm';
ALTER TABLE manager_calls ADD COLUMN IF NOT EXISTS caller text;

CREATE TABLE IF NOT EXISTS manager_payments (
  id serial PRIMARY KEY,
  msg_id text NOT NULL UNIQUE,
  sender text, amount_cents int NOT NULL, received_at timestamptz,
  status text NOT NULL, invoice_number text, note text,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_manager_payments_open ON manager_payments(status) WHERE resolved_at IS NULL;

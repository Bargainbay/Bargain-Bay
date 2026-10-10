-- A rep who is refused a below-floor sale asks an admin to approve it, instead of
-- walking over and asking. The request carries the whole invoice as the rep typed
-- it, so approving is one click and raises exactly what they were trying to raise.
--
-- Rows are history: approved / rejected / withdrawn stay, with who decided and when.
-- `payload` is the invoice body (customer, lines, tax mode, lead source...) and is
-- never edited after the request is filed — what the admin approves is what was asked.

CREATE TABLE IF NOT EXISTS invoice_approval_requests (
  id            bigserial PRIMARY KEY,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','withdrawn')),
  requested_by  text NOT NULL,
  requested_name text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  payload       jsonb NOT NULL,
  payload_hash  text NOT NULL,
  reason        text NOT NULL,
  customer      text,
  total         numeric(12,2),
  rep_note      text,
  decided_by    text,
  decided_name  text,
  decided_at    timestamptz,
  decision_note text,
  invoice_id    bigint,
  invoice_number text
);
CREATE INDEX IF NOT EXISTS idx_invoice_approvals_status ON invoice_approval_requests (status, requested_at DESC);
-- One open request per rep per identical invoice: a double click is not two asks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_approvals_open
  ON invoice_approval_requests (requested_by, payload_hash) WHERE status = 'pending';

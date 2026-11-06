-- Store credit: what a cancelled order's deposit becomes after the 20% restocking fee.
-- A credit is a CODE (transferable, no expiry); its balance is never stored, it is
-- SUM(store_credit_entries.amount). The entries table is append-only.
CREATE TABLE IF NOT EXISTS store_credits (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  issued_to_name  text,
  issued_to_email text,
  invoice_id     int,
  invoice_number text,
  note           text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_credit_entries (
  id          serial PRIMARY KEY,
  credit_id   int NOT NULL REFERENCES store_credits(id),
  amount      numeric(10,2) NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('issued','used','adjustment')),
  invoice_id  int,
  order_id    int,
  ref         text,
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'issued' AND amount > 0) OR (kind = 'used' AND amount < 0) OR kind = 'adjustment')
);
CREATE INDEX IF NOT EXISTS idx_store_credit_entries_credit ON store_credit_entries(credit_id);

CREATE OR REPLACE FUNCTION store_credit_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'store_credit_entries is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS store_credit_entries_no_change ON store_credit_entries;
CREATE TRIGGER store_credit_entries_no_change
  BEFORE UPDATE OR DELETE ON store_credit_entries
  FOR EACH ROW EXECUTE FUNCTION store_credit_entries_append_only();

-- A refund that went to store credit instead of back to the payment method.
ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS to_credit boolean NOT NULL DEFAULT false;

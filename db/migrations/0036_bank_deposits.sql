-- Money IN from the bank feed, kept so incoming e-transfers can be matched to the orders and invoices
-- they pay. The expense importer deliberately drops money in (it would book revenue as a cost); this is
-- the other half. NOTHING here confirms an order: a deposit is matched by a person pressing a button.
CREATE TABLE IF NOT EXISTS bank_deposits (
  id           bigserial PRIMARY KEY,
  ext_id       text NOT NULL UNIQUE,                 -- plaid:<transaction_id>: re-reading a page is free
  received_on  date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  sender       text,                                  -- the bank's description (usually the sender's name)
  memo         text,
  source       text NOT NULL DEFAULT 'plaid',
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','matched','ignored')),
  matched_kind text CHECK (matched_kind IS NULL OR matched_kind IN ('order','invoice')),
  matched_ref  text,                                  -- order number or invoice number
  matched_by   text,
  matched_at   timestamptz,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_deposits_status ON bank_deposits (status, received_on DESC);

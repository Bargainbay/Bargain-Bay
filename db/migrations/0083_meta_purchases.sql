-- Website orders waiting to be reported to Meta as a Purchase, which happens only once they are PAID.
-- A row is written at online checkout (it holds the pixel's browser ids, so the ad can be credited later).
-- No row means never report: staff invoices, walk-ins and orders placed before this table existed.
CREATE TABLE IF NOT EXISTS meta_purchases (
  order_id   integer PRIMARY KEY,
  fbp        text,
  fbc        text,
  claimed_at timestamptz,
  sent_at    timestamptz,
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

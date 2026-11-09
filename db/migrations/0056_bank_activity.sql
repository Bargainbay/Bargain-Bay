-- Every bank line that is NOT an expense row, so the live transaction list can show all of today's activity:
-- pending lines (in or out), money in of any kind, and money out that is not a cost (transfers, loan and card payments).
--
-- A settled money-out line that IS an expense lives in `expenses`; it is never also here. A pending line is replaced
-- by Plaid with the settled one under a new id, so a pending row is deleted when Plaid retracts it.
-- amount is SIGNED: money in is positive, money out is negative.
-- who_override is the sender's name when something else (Interac's confirmation email) told us; the bank usually does not.
CREATE TABLE IF NOT EXISTS bank_activity (
  id            serial PRIMARY KEY,
  ext_id        text NOT NULL UNIQUE,
  activity_date date NOT NULL,
  amount        numeric(12,2) NOT NULL,
  pending       boolean NOT NULL DEFAULT false,
  name          text,
  description   text,
  memo          text,
  category      text,
  account_label text,
  counterparty  text,
  who_override  text,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_activity_date ON bank_activity (activity_date DESC, id DESC);

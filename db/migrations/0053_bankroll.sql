-- The live bankroll: what is in the bank, plus the cash we hold, plus money moved that the bank has
-- not shown yet. This table holds only what a PERSON enters; the bank's own figures come from Plaid.
--
-- kind   cash     a movement of cash on hand (a count at the start is just a first cash entry)
--        pending  money moved through the bank that the bank has not shown yet; it counts toward the
--                 bankroll until it is cleared (the bank now shows it) or voided (it was a mistake)
-- amount signed: money in is positive, money out is negative
-- Rows are never deleted: a mistake is voided, so "what did the bankroll say on Tuesday" has an answer.
CREATE TABLE IF NOT EXISTS bankroll_entries (
  id          serial PRIMARY KEY,
  entry_date  date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('cash', 'pending')),
  amount      numeric(12,2) NOT NULL CHECK (amount <> 0),
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz,
  cleared_by  text,
  voided_at   timestamptz,
  voided_by   text
);
CREATE INDEX IF NOT EXISTS idx_bankroll_entries_date ON bankroll_entries (entry_date DESC, id DESC);

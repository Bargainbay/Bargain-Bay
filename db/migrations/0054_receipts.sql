-- Receipts: a photo (optional) and the facts of one purchase, with where the money came from and,
-- when somebody paid out of their own pocket, whether they have been paid back.
--
-- paid_with  cash      out of the till: becomes a cost AND reduces cash on hand
--            bank      on the business card / e-transfer: the BANK FEED carries the cost, so the
--                      receipt only LINKS to that bank line (expense_id) and tells it the category and HST
--            personal  paid from somebody's own pocket: becomes a cost, not a bank or cash movement,
--                      and is owed back until reimbursed
-- Rows are voided, never deleted.
CREATE TABLE IF NOT EXISTS receipts (
  id               serial PRIMARY KEY,
  receipt_date     date NOT NULL,
  vendor           text,
  total            numeric(12,2) NOT NULL CHECK (total > 0),
  tax              numeric(12,2),
  category         text,
  paid_with        text NOT NULL CHECK (paid_with IN ('cash', 'bank', 'personal')),
  paid_by          text,
  photo_path       text,
  expense_id       int,
  reimburse_status text NOT NULL DEFAULT 'none' CHECK (reimburse_status IN ('none', 'owed', 'reimbursed')),
  reimbursed_on    date,
  reimbursed_how   text,
  reimbursed_note  text,
  reimbursed_by    text,
  note             text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  voided_by        text
);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts (receipt_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_expense ON receipts (expense_id) WHERE expense_id IS NOT NULL;

-- A physical cash count is a third kind of bankroll entry, and a count of nothing is a real answer.
ALTER TABLE bankroll_entries DROP CONSTRAINT IF EXISTS bankroll_entries_kind_check;
ALTER TABLE bankroll_entries DROP CONSTRAINT IF EXISTS bankroll_entries_amount_check;
ALTER TABLE bankroll_entries ADD CONSTRAINT bankroll_entries_kind_check CHECK (kind IN ('cash', 'pending', 'count'));
ALTER TABLE bankroll_entries ADD CONSTRAINT bankroll_entries_amount_check CHECK (kind = 'count' OR amount <> 0);

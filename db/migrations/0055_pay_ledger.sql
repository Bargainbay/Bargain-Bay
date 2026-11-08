-- What each person is owed for work, and what they have been paid, so a balance is always one subtraction.
--
-- kind  owed  an amount earned for a period (period_start..period_end), typed from the payroll figure
--       paid  money handed over, in cash from the till or by e-transfer from the bank
-- A cash payment creates its own wages expense (so the cost is in the books and the till goes down); a bank
-- payment links to the bank line that already carries the cost and marks it as wages. Rows are voided, never deleted.
CREATE TABLE IF NOT EXISTS pay_ledger (
  id           serial PRIMARY KEY,
  person       text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('owed', 'paid')),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  period_start date,
  period_end   date,
  paid_on      date,
  how          text CHECK (how IS NULL OR how IN ('cash', 'bank')),
  expense_id   int,
  note         text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  voided_by    text
);
CREATE INDEX IF NOT EXISTS idx_pay_ledger_person ON pay_ledger (lower(person), kind) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pay_ledger_expense ON pay_ledger (expense_id) WHERE expense_id IS NOT NULL;

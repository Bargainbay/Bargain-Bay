-- Where an "owed" line came from: typed by hand ('manual') or posted from a week of clocked hours ('hours').
-- A week's hours line is updated in place when the hours change, so it never doubles.
ALTER TABLE pay_ledger ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_ledger_hours_week ON pay_ledger (lower(person), period_start)
  WHERE kind = 'owed' AND source = 'hours' AND voided_at IS NULL;

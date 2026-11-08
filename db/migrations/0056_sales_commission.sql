-- Sales Hub phase 3: who a customer "belongs to", when a rep is working from the shop, and the
-- weekly commission statement once the owner has approved it.
--
-- Nothing here stores a commission figure that could be derived. Collected Sales and commission are
-- always recomputed from payments (invoice_payments) and refunds (invoice_refunds). The one thing
-- that IS stored is an APPROVED statement's snapshot, so a week the owner has signed off cannot move
-- when something is corrected later; a later refund shows up as an adjustment on a LATER statement.

-- An "Employee Account": a customer the rep brought in. NULL = nobody's. Set when a rep converts their
-- own lead into a NEW customer, or by an admin with a written reason (audit_log).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS owner_email  text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS owner_set_by text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS owner_set_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS owner_reason text;
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers (lower(owner_email)) WHERE owner_email IS NOT NULL;

-- The rep who brought in a marketplace (liquidation) partner. Their commission on that partner's sales
-- is the tier rate applied to RS Solutions' cut only.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS sourced_by_email text;

-- When a rep is working from the shop. A day with a shop clock-in is an In-house Day; every other
-- working day is a Mobile Day. Deliberately NOT staff_shifts: that table is payroll labour cost (the
-- daily P&L multiplies it by an hourly rate), and a salaried rep must not be counted twice.
CREATE TABLE IF NOT EXISTS rep_shifts (
  id         serial PRIMARY KEY,
  rep_email  text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  place      text NOT NULL DEFAULT 'shop',
  note       text,
  edited_by  text,
  edited_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_shifts_open ON rep_shifts (lower(rep_email)) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rep_shifts_rep ON rep_shifts (lower(rep_email), started_at DESC);

-- An approved (or paid) weekly statement. Weeks nobody has approved are not rows: they are computed.
CREATE TABLE IF NOT EXISTS commission_statements (
  id           serial PRIMARY KEY,
  rep_email    text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  status       text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'paid')),
  total        numeric(12,2) NOT NULL,
  snapshot     jsonb NOT NULL,
  approved_by  text,
  approved_at  timestamptz NOT NULL DEFAULT now(),
  paid_by      text,
  paid_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_statements_week ON commission_statements (lower(rep_email), period_start);

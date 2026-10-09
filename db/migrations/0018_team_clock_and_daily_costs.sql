-- Everyone who works here clocks in, and every recurring cost has a daily figure.
--
-- Until now only delivery drivers had shifts (driver_shifts, started from the
-- driver app). Warehouse, refurb, sales and office staff were on no clock at
-- all, so the one cost that is on every business's books -- their wages --
-- could not be put against a day. This is the smaller, simpler version of that
-- for everybody who is not driving: one tap in, one tap out.
--
-- `employees` is a grant BY EMAIL, same shape as dispatch_access: the person
-- signs up with that address and the grant finds them, in either order. A hire
-- starts on a Monday and might be gone by Friday, so revoking is a flag, not a
-- redeploy, and the row stays: who worked here, between which dates, is the
-- question asked afterwards.
CREATE TABLE IF NOT EXISTS employees (
  id          serial PRIMARY KEY,
  email       text NOT NULL,
  name        text,
  role_label  text,
  hourly_rate numeric(8,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  active      boolean NOT NULL DEFAULT true,
  added_by    text,
  added_at    timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_email ON employees (lower(email));

-- One row per stretch of work. `rate` is SNAPSHOTTED at clock-in: a raise next
-- month must not rewrite what last month cost. NULL rate = nobody had set one,
-- which the daily P&L reports rather than treating as free.
CREATE TABLE IF NOT EXISTS staff_shifts (
  id          serial PRIMARY KEY,
  employee_id int NOT NULL REFERENCES employees(id),
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  rate        numeric(8,2),
  note        text,
  edited_by   text,
  ref         text,
  CONSTRAINT staff_shifts_order CHECK (ended_at IS NULL OR ended_at > started_at)
);
-- One OPEN shift per person, enforced by the database: a double-tap or a replayed
-- request must not open a second shift and double somebody's hours.
CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_open ON staff_shifts (employee_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_shifts_started ON staff_shifts (started_at);

-- The cost list: rent, hydro, insurance, software, truck insurance, loan
-- payments, card fees... each with how often it is billed, so it can be spread
-- into a figure for ONE day. Amounts are PRE-TAX: the HST on a business cost is
-- recovered as an input tax credit, it is not spent.
CREATE TABLE IF NOT EXISTS recurring_costs (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  category   text NOT NULL DEFAULT 'Other',
  amount     numeric(12,2) NOT NULL CHECK (amount >= 0),
  frequency  text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','quarterly','annual','once')),
  starts_on  date NOT NULL DEFAULT CURRENT_DATE,
  ends_on    date,
  note       text,
  active     boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_payments (
  id serial PRIMARY KEY,
  worker text NOT NULL,
  amount numeric(10,2) NOT NULL,
  paid_on date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  voided_at timestamptz
);

-- Monthly quotas for the sales team.
--
-- One row per rep per month, and a row CARRIES FORWARD: the quota in force for a
-- month is the most recent row at or before it. So setting October's targets
-- does not require re-typing them every month, and raising them for November
-- leaves October's history exactly as it was judged at the time.
--
-- `rep_key` is the folded name (lower-case, single-spaced) — the same key the
-- scorecard groups orders on — and `rep_name` is how it was spelled when set.
-- Every target is nullable: NULL means "no target for that measure", which is
-- different from 0 (a target of nothing). A row with all four NULL is a way of
-- ending a rep's quota from that month on.
--
-- "Own" means a lead the rep brought in themselves: the order's `lead_by` name
-- matches the rep. Revenue is pre-tax, the same basis as the Revenue KPI.
CREATE TABLE IF NOT EXISTS sales_quotas (
  id          serial PRIMARY KEY,
  rep_key     text NOT NULL,
  rep_name    text NOT NULL,
  month       date NOT NULL,
  revenue     numeric(12,2) CHECK (revenue     IS NULL OR revenue     >= 0),
  sales       integer       CHECK (sales       IS NULL OR sales       >= 0),
  own_revenue numeric(12,2) CHECK (own_revenue IS NULL OR own_revenue >= 0),
  own_sales   integer       CHECK (own_sales   IS NULL OR own_sales   >= 0),
  set_by      text,
  set_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_quotas_first_of_month CHECK (month = date_trunc('month', month)::date)
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotas_rep_month ON sales_quotas (rep_key, month);

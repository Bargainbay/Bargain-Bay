-- The Sales Hub's lead tracker. A lead is somebody we have NOT sold to yet; the
-- moment one becomes a customer it is linked to customers.id and the CRM
-- (customer_activity / customer_tasks) takes over.
--
-- Ownership is a column, not a table: one owner at a time, protected for 60 days
-- from the last logged activity, after which the nightly pass returns it to the
-- owner's unassigned pool (owner_email NULL).
CREATE TABLE IF NOT EXISTS leads (
  id               serial PRIMARY KEY,
  side             text NOT NULL DEFAULT 'both' CHECK (side IN ('bb', 'rs', 'both')),
  company          text,
  contact_name     text,
  email            text,
  phone            text,
  phone_key        text,
  company_key      text,
  address          text,
  segment          text,
  source           text,
  utm_source       text,
  utm_campaign     text,
  interest_tags    text[] NOT NULL DEFAULT '{}',
  stage            text NOT NULL DEFAULT 'new',
  temperature      text NOT NULL DEFAULT 'cold',
  est_value        numeric(12,2),
  owner_email      text,
  assigned_by      text,
  assigned_at      timestamptz,
  accepted_at      timestamptz,
  first_touch_at   timestamptz,
  last_activity_at timestamptz,
  next_step        text,
  next_step_at     date,
  lost_reason      text,
  customer_id      integer,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_email   ON leads (lower(email))  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone   ON leads (phone_key)     WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads (company_key)   WHERE company_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_owner   ON leads (lower(owner_email));
CREATE INDEX IF NOT EXISTS idx_leads_stage   ON leads (stage);

-- APPEND-ONLY, like customer_activity: a correction is a new row.
CREATE TABLE IF NOT EXISTS lead_activities (
  id            serial PRIMARY KEY,
  lead_id       integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  outcome       text,
  notes         text,
  by_email      text,
  by_name       text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  next_step_at  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_by   ON lead_activities (lower(by_email), occurred_at DESC);

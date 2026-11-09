-- Referral partners: a person who sends us customers and is paid a percentage of the PROFIT on
-- every order those customers place. Not a staff role and not a rep; see lib/referral-partners.js.
CREATE TABLE IF NOT EXISTS referral_partners (
  email          text PRIMARY KEY,
  name           text,
  commission_pct numeric(5,2) NOT NULL DEFAULT 10,
  granted_by     text,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     text
);
-- Which partner a customer account belongs to. Separate from customers.owner_email, which is the
-- business-development rep's Employee Account and feeds a different commission plan.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_set_by text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_set_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_customers_partner ON customers (lower(partner_email)) WHERE partner_email IS NOT NULL;

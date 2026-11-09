-- Referral partners, part 2: what we have paid them, and how many people opened their link.
CREATE TABLE IF NOT EXISTS partner_payments (
  id          serial PRIMARY KEY,
  partner_email text NOT NULL,
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_on     date NOT NULL,
  method      text,
  reference   text,
  note        text,
  recorded_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   text
);
CREATE INDEX IF NOT EXISTS idx_partner_payments_partner ON partner_payments (partner_email);
-- One row per visitor per partner per day: counts distinct people, not page loads.
CREATE TABLE IF NOT EXISTS partner_visits (
  partner_email text NOT NULL,
  visitor       text NOT NULL,
  day           date NOT NULL,
  PRIMARY KEY (partner_email, visitor, day)
);

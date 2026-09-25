-- A customer can be somebody with a phone number and no email address.
--
-- `customers.email` was `text UNIQUE NOT NULL`, so `upsertCustomer` returned
-- null and did nothing for anyone without one. That excluded the two lead
-- sources the business most wants to measure — walk-ins and phone orders — from
-- the very table the lead-source report was built to explain. Sarah's own
-- checkout already passes `email: email || null` and has been silently creating
-- no customer at all.
--
-- IDENTITY, in order of how much it can be trusted:
--   1. email, when there is one;
--   2. the phone, but ONLY for a record that has no email.
--
-- The second part is the careful bit. A hard unique constraint on phone would
-- refuse the second of two family members who share a landline, and losing a
-- real customer is worse than holding a duplicate — duplicates are what
-- mergeCustomers is for. So the phone is an identity only when there is nothing
-- better to go on.

ALTER TABLE customers ALTER COLUMN email DROP NOT NULL;

-- The old column-level UNIQUE becomes a partial index, so NULLs are allowed and
-- many of them can coexist. Kept on `email` rather than `lower(email)` because
-- every write already lowercases (normEmail) and re-keying on a function could
-- fail the migration on data nobody has looked at.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_live
  ON customers (email) WHERE email IS NOT NULL;

-- The phone in E.164, maintained on write. `phone` itself keeps whatever the
-- customer actually gave us, because that is what a person reads back to them.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_key_live
  ON customers (phone_key) WHERE email IS NULL AND phone_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_phone_key ON customers (phone_key);

-- A row identified by nothing is not a customer, it is a name somebody typed.
-- NOT VALID: this table predates the rule and validating history is how a
-- migration fails at deploy time on data that is not what it is guarding
-- against. It is enforced for every new row from here.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_identifiable;
ALTER TABLE customers ADD CONSTRAINT customers_identifiable
  CHECK (email IS NOT NULL OR phone_key IS NOT NULL) NOT VALID;

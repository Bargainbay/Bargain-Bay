-- A seller is not approved until a person has looked their Business Number and HST account up in the
-- CRA registry and written down what it said. The columns record that check; the rules are in
-- lib/business-ids.js and lib/vendors.js (recordIdentityCheck / decideApplication).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS identity_verified_at   timestamptz;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS identity_verified_by   text;
-- The legal name the CRA registry showed, which must agree with the application.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS identity_registry_name text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS identity_note          text;

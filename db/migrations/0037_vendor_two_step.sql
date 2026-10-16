-- A vendor owner's own statement that the account they sign in with has 2-step verification (Google or
-- Microsoft sign-in, phone text codes, or an authenticator). It is a DECLARATION, not something we can
-- check; it is dated and kept. The authenticator-app factor from 0034 stays available but is optional.
ALTER TABLE vendor_users
  ADD COLUMN IF NOT EXISTS two_step_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS two_step_method      text;

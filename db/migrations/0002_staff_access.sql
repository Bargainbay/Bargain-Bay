-- Staff roles in the database, so hiring or firing somebody stops requiring a
-- redeploy.
--
-- ADMIN_EMAILS and SALES_EMAILS remain the floor and are NOT replaced: they are
-- read synchronously from the environment, cannot be broken by a database
-- problem, and are what guarantees the owner can always get in to fix things.
-- This table is ADDITIVE.
--
-- Same shape as accountant_access and dispatch_access, including the part that
-- matters later: the row records who granted it and when, and REVOKING KEEPS
-- THE ROW. "Who had admin, between which dates, and who let them in" is exactly
-- what gets asked afterwards, and "we think we removed them" is not an answer.
CREATE TABLE IF NOT EXISTS staff_access (
  id          serial PRIMARY KEY,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'sales')),
  note        text,
  granted_by  text,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  text,
  revoked_at  timestamptz
);

-- One LIVE grant per person per role. A revoked row stays, so the uniqueness
-- has to be partial or re-granting somebody would collide with their history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_access_live
  ON staff_access (lower(email), role) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_access_email ON staff_access (lower(email));

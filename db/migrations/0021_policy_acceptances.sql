-- Which version of each marketplace policy a seller has accepted, by whom and when. See lib/policy-acceptance.js.
-- Append-only in spirit: a new version is a new row, so "what had they agreed to on the day" always has an answer.
CREATE TABLE IF NOT EXISTS policy_acceptances (
  id           serial PRIMARY KEY,
  vendor_id    integer NOT NULL REFERENCES vendors(id),
  policy       text NOT NULL,
  version      integer NOT NULL CHECK (version > 0),
  accepted_by  text NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  ip           text
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_acceptances_once ON policy_acceptances (vendor_id, policy, version);
CREATE INDEX IF NOT EXISTS policy_acceptances_vendor ON policy_acceptances (vendor_id);

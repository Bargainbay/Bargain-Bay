-- When a partner organisation's login or one of their lead generators last signed in, and how often. Written by the login route
-- only for a login that belongs to a partner (so ordinary customers are never recorded here). The first row for a login is what
-- triggers the "signed in for the first time" email to the owner. Also created at runtime by lib/partner-signin.js.
CREATE TABLE IF NOT EXISTS partner_signins (
  email    text PRIMARY KEY,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at  timestamptz NOT NULL DEFAULT now(),
  n        integer NOT NULL DEFAULT 1
);

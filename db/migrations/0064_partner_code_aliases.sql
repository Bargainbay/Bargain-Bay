-- When a partner's link code is changed, the old one keeps working: links already sent out must not break.
CREATE TABLE IF NOT EXISTS partner_code_aliases (
  alias         text PRIMARY KEY,
  partner_email text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

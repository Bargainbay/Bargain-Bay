-- The business-development rep's signed agreements (Sales Hub, /sales/agreement).
--
-- One row per document per rep per version: 'employment' and 'confidentiality'. What was signed is stored as
-- the exact TEXT the rep saw (text_snapshot) with its sha256, so what was agreed can always be reproduced even
-- after the wording in code changes. The rep's signature is a typed legal name plus the time, IP and browser;
-- the company's countersignature is added later by an admin. Nothing here is derived: it is a record, and it
-- is never deleted (a rep who signs twice for one version is refused by the unique index, not overwritten).
CREATE TABLE IF NOT EXISTS rep_agreements (
  id                 serial PRIMARY KEY,
  rep_email          text NOT NULL,
  doc                text NOT NULL CHECK (doc IN ('employment', 'confidentiality')),
  version            text NOT NULL,
  text_hash          text NOT NULL,
  text_snapshot      text NOT NULL,
  signed_name        text NOT NULL,
  employee_address   text,
  signed_at          timestamptz NOT NULL DEFAULT now(),
  ip                 text,
  user_agent         text,
  countersigned_by   text,
  countersigned_name text,
  countersigned_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_agreements_once ON rep_agreements (lower(rep_email), doc, version);

-- Applications to the Appliance Repair Workshop (/workshop). One row per submission.
-- Kept in the database as well as emailed, so an application is never lost to a failed send.
CREATE TABLE IF NOT EXISTS workshop_applications (
  id            bigserial PRIMARY KEY,
  cohort        text        NOT NULL,
  name          text        NOT NULL,
  email         text        NOT NULL,
  phone         text        NOT NULL,
  city          text,
  experience    text,
  apprenticeship boolean    NOT NULL DEFAULT false,
  about         text,
  heard_from    text,
  ip            text,
  status        text        NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','enrolled','declined','waitlist')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workshop_applications_created ON workshop_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_applications_ip ON workshop_applications (ip, created_at);

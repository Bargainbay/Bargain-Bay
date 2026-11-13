-- Workshop applications become a kanban board: a junk column for fake applicants, a "have we spoken to them" flag,
-- and an append-only log of what was discussed. Same DDL as ensureWorkshopSchema() in lib/workshop-applications.js.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'workshop_applications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE workshop_applications DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE workshop_applications ADD CONSTRAINT workshop_applications_status_check CHECK (status IN ('new','contacted','enrolled','declined','waitlist','junk'));
ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS spoken_to boolean NOT NULL DEFAULT false;
ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS spoken_at timestamptz;
ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS spoken_by text;
ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
CREATE TABLE IF NOT EXISTS workshop_application_notes (
  id             bigserial PRIMARY KEY,
  application_id bigint      NOT NULL REFERENCES workshop_applications(id) ON DELETE CASCADE,
  kind           text        NOT NULL DEFAULT 'note' CHECK (kind IN ('note','spoke','tried')),
  body           text        NOT NULL,
  by_email       text,
  by_name        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workshop_notes_app ON workshop_application_notes (application_id, created_at DESC);

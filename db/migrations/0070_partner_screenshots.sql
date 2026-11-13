-- Phase 4: a generator can upload a screenshot of a customer's details; it is read into the lead form for them to check.
-- The picture (private Blob store) is kept with the lead for 90 days as the record of the inquiry, then deleted; a screenshot
-- that never became a lead is deleted after a week. Nothing here ever holds the customer's details: those live on the lead.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS screenshot_id integer;
CREATE TABLE IF NOT EXISTS partner_screenshots (
  id            serial PRIMARY KEY,
  partner_email text NOT NULL,
  member_email  text NOT NULL,
  key           text,
  hash          text,
  bytes         integer,
  media_type    text,
  read_ok       boolean NOT NULL DEFAULT false,
  lead_id       integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_partner_screenshots_member ON partner_screenshots (member_email, created_at DESC);

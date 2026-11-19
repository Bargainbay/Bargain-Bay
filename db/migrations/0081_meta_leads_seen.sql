-- Which Meta lead-form submissions the puller has already delivered (lib/meta-leads.js).
-- A row is written only AFTER the lead has landed on its board, so a failed delivery is retried
-- on the next pass instead of being dropped. The Meta lead id is the key, so re-reading an
-- overlapping window is free.
CREATE TABLE IF NOT EXISTS meta_leads_seen (
  leadgen_id   text PRIMARY KEY,
  page_id      text NOT NULL,
  form_id      text,
  form_name    text,
  routed_to    text NOT NULL,
  created_time timestamptz,
  seen_at      timestamptz NOT NULL DEFAULT now()
);

-- Every text message the Manager / Tech Manager sends to a member of staff: who sent it,
-- who it went to, and what it said (owner, 2026-11-18). One row per attempt, including the
-- ones that failed or were refused, so "did he get told?" always has an answer.
-- Append-only by convention (nothing in the code updates or deletes a row).
CREATE TABLE IF NOT EXISTS staff_texts (
  id         serial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL,          -- 'manual' (somebody asked for it) | 'nudge' (the Tech Manager's own)
  nudge      text,                   -- shift_open | no_parts | long_on_unit (nudges only)
  subject    text,                   -- what the nudge was about: a unit id, or a shift id
  sent_by    text NOT NULL,          -- 'Tech Manager (AI)', 'Manager (AI)', or a person's email
  to_name    text,
  to_email   text,
  to_phone   text,
  body       text NOT NULL,
  status     text NOT NULL,          -- sent | failed | skipped
  reason     text,                   -- why it failed or was skipped
  sid        text                    -- Twilio's message id
);
CREATE INDEX IF NOT EXISTS idx_staff_texts_to ON staff_texts (lower(to_email), at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_texts_at ON staff_texts (at DESC);

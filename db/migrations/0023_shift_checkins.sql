-- "Are you still working?" -- the evening question put to anyone clocked in
-- after 8pm, whichever clock they are on. One row per question asked.
--
-- kind says which table shift_id points at (staff_shifts or driver_shifts), so
-- there is no foreign key; a closed shift simply stops being asked about.
CREATE TABLE IF NOT EXISTS shift_checkins (
  id          serial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('staff','driver')),
  shift_id    integer NOT NULL,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  answer      text CHECK (answer IS NULL OR answer IN ('yes','no')),
  -- Set once the owner has been told this question went unanswered, so the
  -- ping goes out once and not every ten minutes.
  alerted_at  timestamptz
);
-- At most one UNANSWERED question per shift: the cron may run twice in a minute.
CREATE UNIQUE INDEX IF NOT EXISTS shift_checkins_one_open
  ON shift_checkins (kind, shift_id) WHERE answered_at IS NULL;
CREATE INDEX IF NOT EXISTS shift_checkins_shift ON shift_checkins (kind, shift_id, asked_at DESC);

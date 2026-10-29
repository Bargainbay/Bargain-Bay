-- Internal notes on an order / delivery stop, and "extras" — services the crew did
-- that nobody had assigned, which the office needs in front of it when billing.
-- See lib/order-notes.js. Append-only: a correction is a new note; the only thing
-- that ever changes on a row is billed_at / billed_by.
CREATE TABLE IF NOT EXISTS order_notes (
  id          serial PRIMARY KEY,
  order_id    int REFERENCES orders(id) ON DELETE CASCADE,
  job_id      int REFERENCES jobs(id)   ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'extra')),
  body        text NOT NULL,
  author      text,
  author_name text,
  author_role text NOT NULL DEFAULT 'staff' CHECK (author_role IN ('staff', 'driver')),
  billed_at   timestamptz,
  billed_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR job_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_order_notes_job   ON order_notes(job_id);
CREATE INDEX IF NOT EXISTS idx_order_notes_open_extras ON order_notes(created_at) WHERE kind = 'extra' AND billed_at IS NULL;

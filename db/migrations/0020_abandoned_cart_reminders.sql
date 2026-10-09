-- Abandoned-cart notifications and the customer reminder sequence.
--
-- cart_sessions.notified_at : staff were told about this cart (digest email).
--   Reset when a closed cart refills, exactly like tasked_at.
-- cart_sessions.generation  : bumped each time a closed cart refills, so the
--   same browser starting a NEW cart is a new sequence, not a continuation of
--   the old one's already-sent steps.
-- abandoned_cart_emails     : one row per cart + generation + step. The primary
--   key IS the idempotency guarantee: a step is claimed by inserting its row,
--   and an overlapping cron run loses the race instead of sending twice.
--   status: sending | sent | failed | skipped (skipped = a lower step that was
--   overtaken, e.g. the cron was down; they are never sent late alongside a
--   later one). Rows are history and are never updated back to "unsent".
ALTER TABLE cart_sessions ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE cart_sessions ADD COLUMN IF NOT EXISTS generation int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS abandoned_cart_emails (
  cart_id    int  NOT NULL REFERENCES cart_sessions(id) ON DELETE CASCADE,
  generation int  NOT NULL,
  step       int  NOT NULL CHECK (step BETWEEN 1 AND 3),
  email      text NOT NULL,
  status     text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed','skipped')),
  basis      text,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  PRIMARY KEY (cart_id, generation, step)
);

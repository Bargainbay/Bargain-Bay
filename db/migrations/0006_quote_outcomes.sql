-- Why a quote did not become a sale.
--
-- `expired` has been in the status CHECK and in the conversion logic since
-- quotes were built, and NOTHING HAS EVER SET IT. Quotes sit `open` forever;
-- expiry is enforced only at the moment a customer tries to accept one. So any
-- figure for "open quote value" counts every quote ever written, the list grows
-- monotonically, and nobody can answer why a deal was lost — which is the
-- question a quote list exists to answer.

-- Why it was lost, from a fixed list (QUOTE_LOST_REASONS in lib/constants).
-- A list rather than free text for the same reason as LEAD_SOURCES and
-- jobs.services: one answer spelled four ways is four buckets, and the point is
-- to be able to count them.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_reason text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_note   text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_by     text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_at     timestamptz;

-- When the sweep expired it, as distinct from when it was due to expire. A
-- quote that expired six weeks after its date means the sweep was not running.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- The sweep reads exactly this.
CREATE INDEX IF NOT EXISTS idx_quotes_open_expiry
  ON quotes (expires_at) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_quotes_lost_reason
  ON quotes (lost_reason) WHERE lost_reason IS NOT NULL;

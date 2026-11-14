-- A reseller's offer on one unit. The offer is a REQUEST: nothing is held or priced until an admin accepts it.
-- Accepting holds the unit for the member (a reservations row with no order) and sets expires_at; the accepted price is applied
-- by lib/pricing.js decorate() for that member only, until expires_at or until they buy. Also created at runtime by lib/member-offers.js.
CREATE TABLE IF NOT EXISTS member_offers (
  id            serial PRIMARY KEY,
  user_id       integer NOT NULL,
  email         text NOT NULL,
  business_name text,
  sku           text NOT NULL,
  title         text,
  list_price    numeric(10,2) NOT NULL,          -- the member's own price when they offered
  amount        numeric(10,2) NOT NULL,          -- what they offered
  note          text,
  status        text NOT NULL DEFAULT 'open',    -- open | accepted | countered | declined | withdrawn | expired | purchased
  agreed_price  numeric(10,2),                   -- amount, or the counter
  admin_note    text,
  decided_by    text,
  decided_at    timestamptz,
  expires_at    timestamptz,                     -- end of the accepted hold
  order_id      integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_offers_status_idx ON member_offers (status, created_at DESC);
CREATE INDEX IF NOT EXISTS member_offers_user_idx ON member_offers (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS member_offers_one_live ON member_offers (user_id, upper(sku)) WHERE status IN ('open','countered','accepted');

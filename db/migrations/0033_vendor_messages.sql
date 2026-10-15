-- Messaging between a marketplace seller and Bargain Bay staff.
--
-- A thread belongs to ONE vendor and may be tied (optionally) to one of that vendor's orders, listings or
-- warranty claims. Messages are APPEND-ONLY: a correction is a new message. A message is either visible to
-- the seller or an INTERNAL staff note (side = 'staff' and internal = true) that the seller's queries never
-- select. No customer contact details are stored here and the staff-side guard warns before any are sent.
--
-- Read state is a per-side marker on the thread (vendor_read_at / staff_read_at), not a flag on each
-- message. last_vendor_msg_at / last_staff_msg_at only ever move for seller-VISIBLE messages, so an internal
-- note never makes a thread look unread to the seller and never changes "who is waiting on whom".
CREATE TABLE IF NOT EXISTS vendor_threads (
  id                 serial PRIMARY KEY,
  vendor_id          integer NOT NULL REFERENCES vendors(id),
  subject            text NOT NULL,
  vendor_order_id    integer REFERENCES vendor_orders(id),
  listing_id         integer REFERENCES marketplace_listings(id),
  claim_id           integer REFERENCES warranty_claims(id),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  assigned_to        text,
  started_side       text NOT NULL CHECK (started_side IN ('vendor','staff')),
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_message_at    timestamptz NOT NULL DEFAULT now(),
  last_vendor_msg_at timestamptz,
  last_staff_msg_at  timestamptz,
  -- who spoke last in the seller-VISIBLE conversation; internal notes never move it
  last_public_side   text CHECK (last_public_side IN ('vendor','staff')),
  vendor_read_at     timestamptz,
  staff_read_at      timestamptz,
  closed_at          timestamptz,
  closed_by          text,
  -- throttle: one notification email per side per thread per 15 minutes
  vendor_emailed_at  timestamptz,
  staff_emailed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS vendor_threads_vendor ON vendor_threads (vendor_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS vendor_threads_status ON vendor_threads (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS vendor_messages (
  id            serial PRIMARY KEY,
  thread_id     integer NOT NULL REFERENCES vendor_threads(id),
  side          text NOT NULL CHECK (side IN ('vendor','staff')),
  internal      boolean NOT NULL DEFAULT false,
  author_email  text NOT NULL,
  author_name   text,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_messages_internal_is_staff CHECK (NOT internal OR side = 'staff')
);
CREATE INDEX IF NOT EXISTS vendor_messages_thread ON vendor_messages (thread_id, at, id);
-- the per-vendor rate limit counts a seller's recent messages
CREATE INDEX IF NOT EXISTS vendor_messages_recent ON vendor_messages (side, at);

CREATE OR REPLACE FUNCTION vendor_messages_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'vendor_messages is append-only: send a correcting message instead';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendor_messages_no_change ON vendor_messages;
CREATE TRIGGER vendor_messages_no_change BEFORE UPDATE OR DELETE ON vendor_messages
  FOR EACH ROW EXECUTE FUNCTION vendor_messages_append_only();

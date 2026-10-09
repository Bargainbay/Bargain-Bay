-- Warranty claims on marketplace units. See docs/marketplace/PLAN.md and the Returns, Warranty &
-- Guarantee policy: the seller answers within 48 hours and resolves within 7 days; a missed deadline is
-- ONE strike per claim; a paid claim is taken from the 2% reserve first, then the seller's balance.
--
-- No customer contact details live here, on purpose: a seller sees their claims, and a seller is never
-- given a customer's email or phone. Staff reach the customer through the order.
CREATE TABLE IF NOT EXISTS warranty_claims (
  id                 serial PRIMARY KEY,
  vendor_order_id    integer NOT NULL REFERENCES vendor_orders(id),
  vendor_id          integer NOT NULL REFERENCES vendors(id),
  order_number       text NOT NULL,
  sku                text NOT NULL,
  title              text,
  description        text NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','awaiting_refund','resolved','closed')),
  opened_at          timestamptz NOT NULL DEFAULT now(),
  opened_by          text NOT NULL,
  respond_by         timestamptz NOT NULL,
  resolve_by         timestamptz NOT NULL,
  vendor_responded_at timestamptz,
  vendor_response    text,
  -- the seller has done their part: repaired/replaced it, or agreed we refund the customer
  vendor_done_at     timestamptz,
  resolution         text CHECK (resolution IS NULL OR resolution IN ('repair','replace','refund')),
  resolution_note    text,
  resolved_at        timestamptz,
  resolved_by        text,
  closed_reason      text,
  -- money out, set by an admin only (cents)
  cost_cents         bigint CHECK (cost_cents IS NULL OR cost_cents > 0),
  charged_at         timestamptz,
  charged_by         text,
  -- ONE strike per claim, whichever deadline is missed first. strike_pending_at is the claim-first
  -- guard that stops two overlapping sweeps striking twice.
  strike_pending_at  timestamptz,
  strike_id          integer,
  reminded_respond   boolean NOT NULL DEFAULT false,
  reminded_resolve   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS warranty_claims_vendor ON warranty_claims (vendor_id, status);
CREATE INDEX IF NOT EXISTS warranty_claims_open ON warranty_claims (status) WHERE status IN ('open','responded','awaiting_refund');
CREATE UNIQUE INDEX IF NOT EXISTS warranty_claims_one_open_per_unit
  ON warranty_claims (vendor_order_id, sku) WHERE status IN ('open','responded','awaiting_refund');

CREATE TABLE IF NOT EXISTS warranty_claim_notes (
  id         serial PRIMARY KEY,
  claim_id   integer NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  author     text NOT NULL,
  side       text NOT NULL CHECK (side IN ('staff','vendor')),
  -- internal notes are for us (they may discuss the customer); the seller never sees them
  internal   boolean NOT NULL DEFAULT false,
  note       text NOT NULL
);
CREATE INDEX IF NOT EXISTS warranty_claim_notes_claim ON warranty_claim_notes (claim_id, at);

-- Marketplace foundation: vendors, who may act for them, their commission, their
-- strikes, and an append-only trail of every decision. See docs/marketplace/PLAN.md.
--
-- Deliberately NOT here yet: listings, orders, the payout ledger and bank details.
-- Those land in later migrations; nothing in this file touches `products`, which
-- the tracker sync rewrites and deactivates wholesale.

CREATE TABLE IF NOT EXISTS vendors (
  id              serial PRIMARY KEY,
  slug            text NOT NULL,
  legal_name      text NOT NULL,
  trade_name      text,
  business_no     text,
  hst_no          text,
  -- NULL is "nobody has looked", which is not the same as small_supplier.
  hst_status      text CHECK (hst_status IS NULL OR hst_status IN ('registered','small_supplier')),
  source_of_goods text,
  contact_name    text,
  contact_email   text NOT NULL,
  contact_phone   text,
  address         text,
  city            text,
  postal          text,
  status          text NOT NULL DEFAULT 'applied'
                  CHECK (status IN ('applied','approved','restricted','suspended','terminated','rejected')),
  -- 0 probation, 1 standard, 2 trusted. Computed from performance later; an
  -- admin can override and the override is an event.
  tier            smallint NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 2),
  approved_at     timestamptz,
  approved_by     text,
  status_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_slug ON vendors (slug);

-- Vendor access is DATABASE-backed, like dispatch_access: a vendor user is on no
-- staff list, so every existing admin surface refuses them without knowing the
-- role exists. Revoking keeps the row.
CREATE TABLE IF NOT EXISTS vendor_users (
  id          serial PRIMARY KEY,
  vendor_id   integer NOT NULL REFERENCES vendors(id),
  email       text NOT NULL,
  name        text,
  role        text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  granted_by  text,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  text
);
-- Partial, or re-granting someone would collide with their own history.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_users_active
  ON vendor_users (lower(email)) WHERE revoked_at IS NULL;

-- Commission is a rate WITH A START DATE, so raising it later never rewrites a
-- past sale. vendor_id NULL is the platform default; a vendor row overrides it.
CREATE TABLE IF NOT EXISTS commission_rates (
  id             serial PRIMARY KEY,
  vendor_id      integer REFERENCES vendors(id),
  rate_bps       integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),
  effective_from date NOT NULL,
  set_by         text,
  set_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commission_rates_vendor_from
  ON commission_rates (COALESCE(vendor_id, 0), effective_from);
-- No seed row: the 10% launch rate (owner, 2026-10-08) is DEFAULT_COMMISSION_BPS in
-- lib/marketplace-rules.js, which commissionBpsFor falls back to. A migration that
-- seeds data makes a fresh database non-empty, and a restore into one collides.

-- A strike is one missed deadline or one serious breach. Three active strikes
-- restrict the vendor. Strikes do NOT expire on a timer: they come off only when
-- management revises them, and a revised strike stays on the record.
CREATE TABLE IF NOT EXISTS vendor_strikes (
  id              serial PRIMARY KEY,
  vendor_id       integer NOT NULL REFERENCES vendors(id),
  reason_code     text NOT NULL CHECK (reason_code IN (
                    'missed_accept','missed_ready','cancelled_order','not_as_described',
                    'missed_handover','warranty_response','off_platform_contact',
                    'review_manipulation','document_falsification','other')),
  order_ref       text,
  note            text,
  issued_by       text,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  -- the periodic review list resurfaces a strike 90 days after this moment
  last_review_at  timestamptz NOT NULL DEFAULT now(),
  revised_at      timestamptz,
  revised_by      text,
  revised_reason  text,
  CONSTRAINT vendor_strikes_revision_complete CHECK (
    (revised_at IS NULL AND revised_by IS NULL AND revised_reason IS NULL)
    OR (revised_at IS NOT NULL AND revised_reason IS NOT NULL AND length(btrim(revised_reason)) > 0))
);
CREATE INDEX IF NOT EXISTS vendor_strikes_vendor ON vendor_strikes (vendor_id) WHERE revised_at IS NULL;

-- Append-only audit trail. Corrections are new rows.
CREATE TABLE IF NOT EXISTS vendor_events (
  id         serial PRIMARY KEY,
  vendor_id  integer NOT NULL REFERENCES vendors(id),
  event      text NOT NULL,
  actor      text,
  detail     jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_events_vendor ON vendor_events (vendor_id, at);

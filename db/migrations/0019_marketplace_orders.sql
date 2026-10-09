-- Marketplace orders: one row per vendor (and lane) on a customer's order, carrying the two
-- clocks, the vendor's insurance choice and the delivery-service fee. See docs/marketplace/PLAN.md §10–§12.
--
-- The customer's order is still ONE order with ONE invoice. This table is the vendor's view of
-- the part of it that is theirs; it does not create a second order and so cannot book the sale twice.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vendor_id integer;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS listing_id integer;
CREATE INDEX IF NOT EXISTS idx_items_vendor ON order_items (vendor_id) WHERE vendor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS vendor_orders (
  id                   serial PRIMARY KEY,
  order_id             integer NOT NULL,
  order_number         text NOT NULL,
  vendor_id            integer NOT NULL REFERENCES vendors(id),
  lane                 text NOT NULL CHECK (lane IN ('A','B','C')),
  status               text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
                         'awaiting_payment','awaiting_accept','accepted','ready','delivered','cancelled')),
  item_cents           bigint NOT NULL CHECK (item_cents > 0),
  -- Lane C: the vendor's 80% of the customer's delivery fee for this shipment.
  lane_c_delivery_cents bigint NOT NULL DEFAULT 0 CHECK (lane_c_delivery_cents >= 0),
  -- Both clocks start when WE confirm the e-transfer; the vendor is not told before that.
  confirmed_at         timestamptz,
  accept_by            timestamptz,
  ready_by             timestamptz,
  accepted_at          timestamptz,
  ready_at             timestamptz,
  -- Lane A/B only. NULL until the vendor chooses; there is deliberately no default.
  insurance_choice     text CHECK (insurance_choice IS NULL OR insurance_choice IN ('insured','declined')),
  insurance_cents      bigint NOT NULL DEFAULT 0 CHECK (insurance_cents >= 0),
  delivery_service_cents bigint NOT NULL DEFAULT 0 CHECK (delivery_service_cents >= 0),
  -- Lane C
  carrier              text,
  tracking_number      text,
  delivered_at         timestamptz,
  settled_at           timestamptz,
  cancelled_at         timestamptz,
  cancel_code          text,
  cancel_note          text,
  cancelled_by         text,
  -- so a sweep that runs every half hour never strikes or emails twice
  accept_strike_id     integer,
  ready_strike_id      integer,
  reminded_accept_12   boolean NOT NULL DEFAULT false,
  reminded_accept_20   boolean NOT NULL DEFAULT false,
  reminded_ready_60    boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_orders_one_per_lane UNIQUE (order_id, vendor_id, lane)
);
CREATE INDEX IF NOT EXISTS vendor_orders_vendor ON vendor_orders (vendor_id, status);
CREATE INDEX IF NOT EXISTS vendor_orders_open ON vendor_orders (status) WHERE status IN ('awaiting_payment','awaiting_accept','accepted');

-- Our fee for collecting/delivering a vendor's unit, by size class. Set by an admin once and
-- edited when real pickup costs are known; the amount actually charged is copied onto the
-- vendor order at accept time, so a later change never rewrites a past statement.
-- No seed rows: until set, the fee is 0 and the admin screen says so.
CREATE TABLE IF NOT EXISTS delivery_service_rates (
  size_class  text PRIMARY KEY CHECK (size_class IN ('small','standard','oversize')),
  cents       integer NOT NULL CHECK (cents >= 0),
  set_by      text,
  set_at      timestamptz NOT NULL DEFAULT now()
);

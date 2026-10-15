-- The vendor's delivery-service fee for a Lane B collection depends on HOW FAR the unit is from our
-- Pickering warehouse (zone) and how big it is (size class) — PLAN.md §8.1a. Lane A (the vendor
-- brings it to us) keeps the flat per-size handling rates in delivery_service_rates.
--
-- No seed rows (a migration that seeds data makes a fresh database non-empty and breaks the
-- backup-restore tests). lib/pickup-zones.js carries a starter schedule that applies until an
-- admin saves a row, and the admin screen says it is a starter.

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS pickup_km        numeric(6,1) CHECK (pickup_km IS NULL OR pickup_km >= 0),
  ADD COLUMN IF NOT EXISTS pickup_km_source text;           -- 'google' | 'staff'

CREATE TABLE IF NOT EXISTS delivery_service_zone_rates (
  zone        smallint NOT NULL CHECK (zone BETWEEN 1 AND 3),
  size_class  text     NOT NULL CHECK (size_class IN ('small','standard','oversize')),
  cents       integer  NOT NULL CHECK (cents >= 0),
  set_by      text,
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone, size_class)
);

-- What was charged, itemised, copied at accept time so a later rate change never rewrites a statement.
ALTER TABLE vendor_orders
  ADD COLUMN IF NOT EXISTS delivery_service_detail jsonb;

-- Bargain Bay — Postgres schema
-- Bootstrap:  psql "$POSTGRES_URL" -f db/schema.sql
-- Safe to re-run (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text UNIQUE NOT NULL,          -- stored lowercase by the app
  name          text,
  phone         text,
  password_hash text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                serial PRIMARY KEY,
  order_number      text UNIQUE,               -- 'BB-' || (1000 + id), set right after insert
  user_id           int REFERENCES users(id),  -- null for guest checkout
  email             text NOT NULL,
  name              text,
  phone             text,
  delivery_method   text CHECK (delivery_method IN ('pickup','delivery')),
  address           text,
  city              text,
  postal            text,
  status            text NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment','confirmed','ready','out_for_delivery','delivered','cancelled')),
  subtotal          numeric(10,2),
  hst               numeric(10,2),
  total             numeric(10,2),
  stripe_session_id text,
  notes             text,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id       serial PRIMARY KEY,
  order_id int REFERENCES orders(id) ON DELETE CASCADE,
  sku      text NOT NULL,
  title    text,
  price    numeric(10,2)
);

-- One row per SKU. A unit is "held" while expires_at is in the future.
CREATE TABLE IF NOT EXISTS reservations (
  sku        text PRIMARY KEY,
  order_id   int,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_number  ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_items_order    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_sku      ON order_items(sku);

-- Idempotent upgrades for databases created before these columns existed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id text;

-- Clearance overrides. One row per SKU put on clearance. Layered onto the
-- catalog at render time (like reservations). active=false hides it without
-- losing the markdown. warranty_months defaults to 3 for clearance units.
CREATE TABLE IF NOT EXISTS clearance (
  sku             text PRIMARY KEY,
  price           numeric(10,2) NOT NULL,
  warranty_months int  NOT NULL DEFAULT 3,
  note            text,
  active          boolean NOT NULL DEFAULT true,
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clearance_active ON clearance(active);

-- Live inventory mirror of the master tracker's available ("Tested Working")
-- units (Phase A). Populated by /api/admin/sync-inventory, which reads the
-- tracker server-side. active=false = the unit left the available set
-- (sold / status changed / removed), so it drops off the storefront.
CREATE TABLE IF NOT EXISTS products (
  sku        text PRIMARY KEY,
  make       text,
  model      text,
  category   text,
  title      text,
  condition  text,
  price      numeric(10,2),
  compare_at numeric(10,2),
  cost       numeric(10,2),
  uid        text,
  position   int DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  synced_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Phase B: local "sold" ledger. When a unit is sold through the site (paid order)
-- or the CRM (invoice paid out-of-band), we mark it sold HERE so it drops off the
-- storefront immediately AND survives the next tracker/CSV re-import (which would
-- otherwise re-list it, since the import reconciles `active` straight from the
-- tracker). tracker_synced flips true once the owner has marked it Sold in the
-- master tracker — the reconciliation checklist until Google write-back is enabled.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_at        timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_price     numeric(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_channel   text;    -- 'order' | 'invoice' | 'manual'
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_ref       text;    -- order number / invoice number
ALTER TABLE products ADD COLUMN IF NOT EXISTS tracker_synced boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_products_sold ON products(sold_at) WHERE sold_at IS NOT NULL;

-- Member / reseller portal: tier + approval state on users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role               text NOT NULL DEFAULT 'client'; -- client | member
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_status      text DEFAULT 'none';             -- none | pending | approved | rejected
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name      text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_note        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_requested_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_approved_at  timestamptz;

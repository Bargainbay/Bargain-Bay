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
  image_url  text,
  position   int DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  synced_at  timestamptz DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
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

-- Interim offline payments: how the customer intends to pay an order placed
-- while card checkout is off — 'etransfer' or 'in_person' (pay on pickup/delivery).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text;

-- Phase 2 pickup scheduling: the customer-booked appointment slot, stored as a
-- store-local "YYYY-MM-DDTHH:MM" label (America/Toronto). Null until booked.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_slot text;

-- Phase C: salvage / parts-only units (Status "Salvage For Parts Only" in the
-- tracker — never on the storefront). Synced separately; disposed when invoiced.
CREATE TABLE IF NOT EXISTS salvage_units (
  sku            text PRIMARY KEY,
  make           text,
  model          text,
  title          text,
  cost           numeric(10,2),
  status         text NOT NULL DEFAULT 'available',  -- available | disposed
  sale_price     numeric(10,2),
  invoice_number text,
  disposed_at    timestamptz,
  synced_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salvage_status ON salvage_units(status);

-- Phase 3 delivery ops + driver portal.
ALTER TABLE users  ADD COLUMN IF NOT EXISTS is_driver boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date  date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_id      int REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at   timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pod_signature  text;  -- private-blob pathname of the signature (Phase 3b)
CREATE TABLE IF NOT EXISTS pod_photos (
  id         serial PRIMARY KEY,
  order_id   int REFERENCES orders(id) ON DELETE CASCADE,
  url        text,   -- private blob url
  pathname   text,   -- blob pathname (for the admin download proxy)
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_pod_photos_order ON pod_photos(order_id);

-- Manual invoicing without Stripe: owner builds an invoice, customer pays by
-- Interac e-transfer (or in person), owner marks it paid. Replaces the old
-- Stripe-Invoicing flow after Stripe paused the account.
CREATE TABLE IF NOT EXISTS invoices (
  id             serial PRIMARY KEY,
  number         text UNIQUE,                 -- 'INV-' || (1000 + id)
  email          text NOT NULL,
  name           text,
  status         text NOT NULL DEFAULT 'open' -- open | paid | void | refunded
                 CHECK (status IN ('open','paid','void','refunded')),
  subtotal       numeric(10,2),
  hst            numeric(10,2),
  total          numeric(10,2),
  memo           text,
  due_date       date,
  payment_method text,                        -- how it was paid (cash/etransfer/...)
  paid_at        timestamptz,
  refunded_at    timestamptz,                 -- set when a paid invoice is refunded
  created_at     timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id          serial PRIMARY KEY,
  invoice_id  int REFERENCES invoices(id) ON DELETE CASCADE,
  description text,
  sku         text,
  amount      numeric(10,2)
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
-- Fulfilment intent captured on the invoice; when it's marked paid, a matching
-- order is created (delivery_method/address flow into the order). order_id links
-- the created fulfilment order back (and guards against double-creation).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_method text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS address  text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS city     text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS postal   text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phone    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id int REFERENCES orders(id) ON DELETE SET NULL;

-- ── Quotes ──────────────────────────────────────────────────────────────────
-- Non-binding package quotes the owner builds in /admin/quotes and shares with a
-- client (hosted page + email). A quote reserves NOTHING — the units stay live
-- and sellable for everyone — until it's converted into an invoice, which is
-- where stock actually gets held/sold. Bundle pricing = a % off the our-price
-- subtotal, plus an optional all-in cash deal and a free-delivery perk.
CREATE TABLE IF NOT EXISTS quotes (
  id                   serial PRIMARY KEY,
  number               text UNIQUE,                 -- 'Q-' || (1000 + id)
  email                text NOT NULL,
  name                 text,
  status               text NOT NULL DEFAULT 'open' -- open | accepted | converted | expired | void
                       CHECK (status IN ('open','accepted','converted','expired','void')),
  retail_subtotal      numeric(10,2),
  subtotal             numeric(10,2),               -- our-price subtotal (pre-bundle)
  bundle_pct           numeric(5,2) DEFAULT 0,      -- bundle discount %
  bundle_price         numeric(10,2),               -- subtotal after the bundle %
  hst                  numeric(10,2),
  total                numeric(10,2),               -- what the client pays (cash_deal if set, else bundle_price + hst)
  cash_deal            numeric(10,2),               -- optional all-in cash offer (overrides total)
  free_delivery        boolean DEFAULT false,
  memo                 text,
  expires_at           date,
  converted_invoice_id int REFERENCES invoices(id) ON DELETE SET NULL,
  created_at           timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quote_items (
  id          serial PRIMARY KEY,
  quote_id    int REFERENCES quotes(id) ON DELETE CASCADE,
  description text,
  sku         text,
  retail      numeric(10,2),
  amount      numeric(10,2)                          -- our price for this line
);
-- 'admin' = owner-built; 'customer' = assembled on /bundle (a quote request).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- Cleanup: a sold unit should never stay on clearance. markUnitsSold handles
-- this going forward; this sweeps any rows sold before that fix. Idempotent.
UPDATE clearance SET active = false, updated_at = now()
 WHERE active = true AND sku IN (SELECT sku FROM products WHERE sold_at IS NOT NULL);

-- Member / reseller portal: tier + approval state on users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role               text NOT NULL DEFAULT 'client'; -- client | member
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_status      text DEFAULT 'none';             -- none | pending | approved | rejected
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name      text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_note        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_requested_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_approved_at  timestamptz;
-- Session revocation: bumped on logout / password change to invalidate any JWT
-- issued before it (lib/auth embeds it in the token as `tv`).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version       int NOT NULL DEFAULT 0;

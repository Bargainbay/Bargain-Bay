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
  sku      text,                              -- null for service/fee/ad-hoc lines (no unit SKU)
  title    text,
  price    numeric(10,2),                     -- negative on a discount / trade-in line
  kind     text                               -- unit | service | discount | trade_in (null = unit)
);
-- Older DBs created sku NOT NULL; service/ad-hoc invoice lines have no SKU and
-- must still bridge into an order, so relax it (idempotent).
ALTER TABLE order_items ALTER COLUMN sku DROP NOT NULL;
-- Mirrors invoice_items.kind: 'unit' | 'service' | 'discount' | 'trade_in'.
-- Without it an order can't tell an appliance being DELIVERED from a trade-in
-- being COLLECTED — both are just a title and a price — and the dispatch board,
-- the run sheet and the driver all have to know the difference. NULL means unit
-- (every row predating this column is one).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kind text;

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
-- What the storefront took off with a promo code. Stored on the order so every
-- downstream reader agrees on it — the delivery fee is otherwise inferred as
-- total − subtotal − hst, which a discount would silently corrupt.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0;
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
  status         text NOT NULL DEFAULT 'open' -- open | partial | paid | void | refunded
                 CHECK (status IN ('open','partial','paid','void','refunded')),
  subtotal       numeric(10,2),
  hst            numeric(10,2),
  total          numeric(10,2),
  memo           text,
  due_date       date,
  payment_method text,                        -- how it was paid (cash/etransfer/...)
  paid_at        timestamptz,
  refunded_at    timestamptz,                 -- set when a paid invoice is FULLY refunded
  refund_total   numeric(10,2) NOT NULL DEFAULT 0, -- money returned so far, incl. HST share (partial/per-unit refunds)
  -- How the prices were TYPED, not how they're stored: line amounts are always
  -- pre-tax. This exists only so reopening an invoice quoted tax-in shows the rep
  -- the figures they keyed, rather than $884.96 where they typed $1,000.
  tax_inclusive  boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now()    -- issued date; backdatable for late-recorded sales
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id          serial PRIMARY KEY,
  invoice_id  int REFERENCES invoices(id) ON DELETE CASCADE,
  description text,
  sku         text,
  amount      numeric(10,2),
  refunded_at timestamptz                     -- set per line on a partial (per-unit) refund
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
-- Individual payments against an invoice (deposits / instalments / the closing
-- balance). A paid invoice's rows sum to its total; 'partial' invoices have some.
CREATE TABLE IF NOT EXISTS invoice_payments (
  id         serial PRIMARY KEY,
  invoice_id int NOT NULL,
  amount     numeric(10,2) NOT NULL,
  method     text NOT NULL,
  note       text,
  paid_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
-- One row per refund event, so "already refunded $840" can always be explained.
-- invoices.refund_total is the running sum of `amount` here. kind: 'items' (units
-- came back) | 'amount' (money-only adjustment) | 'full'. restocking_fee is money
-- KEPT on a change-of-mind return (incl. its HST share) — it stays booked as
-- revenue on the order, so refunds + fees kept equal what the customer was charged.
CREATE TABLE IF NOT EXISTS invoice_refunds (
  id             serial PRIMARY KEY,
  invoice_id     int NOT NULL,
  amount         numeric(10,2) NOT NULL,
  restocking_fee numeric(10,2) NOT NULL DEFAULT 0,
  restocking_pct numeric(5,2)  NOT NULL DEFAULT 0,
  kind           text NOT NULL,
  reason         text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_refunds_invoice ON invoice_refunds(invoice_id);
-- Fulfilment intent captured on the invoice; when it's marked paid, a matching
-- order is created (delivery_method/address flow into the order). order_id links
-- the created fulfilment order back (and guards against double-creation).
-- The order is raised as soon as the invoice is WRITTEN, not when it's paid: it
-- sits in 'pending_payment' holding the units off the storefront until the money
-- is in, so a deposit sale has a BB- number, a slot on the fulfilment board, and
-- a place on the revenue dashboard from day one.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_method text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS address  text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS city     text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS postal   text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phone    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id int REFERENCES orders(id) ON DELETE SET NULL;
-- The dashboards ask "is this order backed by a live invoice?" for every order
-- row they touch, and the 24h abandoned-checkout sweep asks it too. Without this
-- index that's a sequential scan of invoices per order.
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id) WHERE order_id IS NOT NULL;
-- Who raised the invoice. created_by (email) is the stable identity — it's what
-- the SALES_EMAILS gate keys off — and created_by_name is snapshotted at
-- creation so the record still reads right after a rename or a departure. Also
-- pushed onto orders.sales_rep, which is what the dashboard's per-rep revenue
-- leaderboard reads.
-- Where the invoice came from: 'manual' (a rep in /admin/invoices), 'web' (raised
-- automatically for a storefront checkout), 'phone', 'quote', 'salvage'. It has
-- real behaviour attached: a WEB invoice MIRRORS its order rather than driving
-- it, and must not shield an abandoned checkout from the 24h auto-cancel sweep
-- the way a manual (deposit) invoice does.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by      text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_name text;
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(lower(created_by));

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

-- Client database: one consolidated customer record per email, fed by every
-- checkout / invoice / quote / signup (lib/customers.js self-provisions this;
-- kept here as the canonical reference).
CREATE TABLE IF NOT EXISTS customers (
  id         serial PRIMARY KEY,
  email      text UNIQUE NOT NULL,                  -- lowercased identity key
  name       text,
  phone      text,
  address    text,                                  -- last known delivery address
  city       text,
  postal     text,
  notes      text,                                  -- owner's freeform notes
  user_id    int,                                   -- linked account, when one exists
  created_at timestamptz DEFAULT now(),             -- earliest sighting across sources
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (lower(name));

-- Order-level refunds (storefront orders; invoice-bridged ones refund via the
-- invoice). lib/orders.js self-provisions these + widens the status CHECK to
-- include 'refunded'; kept here as the canonical reference.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at  timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_total numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending_payment','confirmed','ready','out_for_delivery','delivered','cancelled','refunded'));

-- Customer quote acceptance (hosted quote page "Accept" button).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- ============================================================================
-- Dispatch: deliveries and service calls, from any source
-- ============================================================================
-- A JOB is not an order. An order carries money, tax, inventory and revenue
-- meaning; a service call run for another company carries none of that, and
-- forcing it into `orders` would pollute every revenue query. A Bargain Bay
-- delivery becomes a job that LINKS BACK to its order (jobs.order_id), so
-- completing the job can still advance the order.
CREATE TABLE IF NOT EXISTS clients (
  id                 serial PRIMARY KEY,
  name               text NOT NULL UNIQUE,
  contact_email      text,
  contact_phone      text,
  notes              text,
  notify_on_complete boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id            serial PRIMARY KEY,
  job_number    text UNIQUE,                      -- 'RS-' || (1000 + id)
  type          text NOT NULL DEFAULT 'delivery'
                CHECK (type IN ('delivery','service_call','pickup')),
  -- unscheduled: on the board, no day yet. scheduled: has a day (+ driver or not).
  -- failed is a REAL outcome with a reason, not an absence of a completion.
  status        text NOT NULL DEFAULT 'unscheduled'
                CHECK (status IN ('unscheduled','scheduled','on_the_way','arrived','done','failed','cancelled')),
  client_id     int REFERENCES clients(id) ON DELETE SET NULL,
  source        text NOT NULL DEFAULT 'manual',   -- manual | bargain_bay | email | import
  order_id      int REFERENCES orders(id) ON DELETE SET NULL,

  customer_name text,
  phone         text,
  email         text,
  address       text,
  city          text,
  postal        text,
  -- Captured from the address autocomplete at entry time, so routing never has
  -- to pay to geocode the same address later.
  lat           numeric(9,6),
  lng           numeric(9,6),

  job_date      date,
  window_start  time,                             -- the promised window
  window_end    time,

  driver_id     int REFERENCES users(id) ON DELETE SET NULL,
  seq           int,                              -- position in that driver's day

  notes         text,                             -- access: stairs, buzzer, dog
  fail_reason   text,
  created_by      text,
  created_by_name text,
  created_at    timestamptz DEFAULT now(),
  started_at    timestamptz,
  arrived_at    timestamptz,
  completed_at  timestamptz,
  -- A trade-in is an appliance we have BOUGHT and therefore have to come back
  -- with. The credit itself lives on the order (order_items.kind='trade_in');
  -- these record whether the thing actually made it onto the van, because
  -- "we'll grab it next time" is how a unit we already paid for disappears.
  trade_in_collected timestamptz,
  trade_in_note      text
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trade_in_collected timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trade_in_note      text;

CREATE TABLE IF NOT EXISTS job_items (
  id          serial PRIMARY KEY,
  job_id      int REFERENCES jobs(id) ON DELETE CASCADE,
  description text NOT NULL,
  sku         text,                               -- set when it came from Bargain Bay
  qty         int NOT NULL DEFAULT 1
);

-- Timestamped audit trail. This is what answers "what actually happened Tuesday".
CREATE TABLE IF NOT EXISTS job_events (
  id       serial PRIMARY KEY,
  job_id   int REFERENCES jobs(id) ON DELETE CASCADE,
  event    text NOT NULL,
  detail   text,
  by_email text,
  by_name  text,
  at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_date        ON jobs(job_date);
CREATE INDEX IF NOT EXISTS idx_jobs_driver_date ON jobs(driver_id, job_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_order       ON jobs(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_items_job    ON job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_job_events_job   ON job_events(job_id);

-- ── Service tickets ─────────────────────────────────────────────────────────
-- A ticket is the CUSTOMER'S PROBLEM; a job is one visit against it. They are
-- separate because a service call routinely takes more than one trip — diagnose,
-- order the part, come back — and "how many open service calls do we have" has
-- to count problems, not visits, or every revisit inflates the number.
CREATE TABLE IF NOT EXISTS service_tickets (
  id            serial PRIMARY KEY,
  ticket_number text UNIQUE,                      -- 'SC-' || (1000 + id)
  client_id     int REFERENCES clients(id) ON DELETE SET NULL,
  customer_name text, phone text, email text,
  address text, city text, postal text,
  appliance     text,                             -- what it is
  issue         text,                             -- what's wrong, as reported
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','awaiting_parts','scheduled','resolved','closed','cancelled')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  created_by    text, created_by_name text
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON service_tickets(status);

-- A visit belongs to a ticket; deliveries have none.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ticket_id     int REFERENCES service_tickets(id) ON DELETE SET NULL;
-- How far into the property the crew goes: 'white_glove' (into the room,
-- unpacked, placed) or 'threshold' (the door and no further). The driver needs
-- to know which before they get out of the van.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shipment_type text;
-- What's being done on the stop — install, haul away, exchange and so on. Tags
-- rather than free text so they can be counted and filtered; one visit is
-- routinely several of them at once.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS services      text[];
-- Service visit record.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_in       timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_out      timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome       text;   -- fixed | not_fixed | parts_needed | pending | no_fault
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_used    text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_needed  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_by     text;
CREATE INDEX IF NOT EXISTS idx_jobs_ticket ON jobs(ticket_id) WHERE ticket_id IS NOT NULL;
-- A warranty call on something we sold points back at the sale.
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS order_id int REFERENCES orders(id) ON DELETE SET NULL;
-- What the person who did the job is owed for it. Per job and set after the
-- fact, because the rate depends on what the stop actually turned out to be.
-- SEPARATE from lib/payroll.js, which pays shop work by piece rate and drivers a
-- flat rate per Bargain Bay ORDER delivered — using both for the same delivery
-- counts it twice.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_amount numeric(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_note   text;

-- What we CHARGE the client (pay_amount is what the job costs us). invoice_id is
-- what stops a job being billed twice.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS charge_amount numeric(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS charge_note   text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_id    int REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_invoice ON jobs(invoice_id) WHERE invoice_id IS NOT NULL;
-- A transfer runs FROM one address TO another — five pieces out of Mississauga
-- into Burlington is one job with two ends, and the driver needs both.
-- A transfer has two ends, and both are somewhere a driver has to be let into.
-- A second person on the same stop: one van, one run, two names.
-- Cash the driver comes back with that is NOT an invoice balance: a haul-away
-- the customer pays for at the door, a client's own surcharge. It used to arrive
-- only as a sentence inside a client's notes and printed at the same weight as a
-- reference number; lib/cash-at-the-door.js reads those, this holds the ones
-- somebody actually typed.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS collect_cash      numeric(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS collect_cash_note text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS driver2_id     int;
CREATE INDEX IF NOT EXISTS idx_jobs_driver2 ON jobs(driver2_id, job_date) WHERE driver2_id IS NOT NULL;
-- The same person cannot be both people on a stop. Enforced HERE and not only in
-- the code that writes a crew, because the way this broke was a function that
-- wrote driver_id directly and never consulted the rule: resequence set the
-- column's driver on every card in it, including the stops that were in that
-- column because the driver was the SECOND man. One person then held both seats,
-- the next assignment dropped the duplicate second seat, and the driver who was
-- really riding was gone off the stop with nothing to say so.
UPDATE jobs SET driver2_id = NULL
 WHERE driver2_id IS NOT NULL AND (driver2_id = driver_id OR driver_id IS NULL);
DO $crew$ BEGIN
  ALTER TABLE jobs ADD CONSTRAINT jobs_crew_distinct
    CHECK (driver2_id IS NULL OR (driver_id IS NOT NULL AND driver2_id <> driver_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $crew$;
-- Who we collect FROM (the shipper), as distinct from who to ring there.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_company text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_name    text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_phone   text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_address text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_city    text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_postal  text;
-- Which business an invoice goes out as: 'bargain_bay' (the storefront) or
-- 'rs_solutions' (the delivery/service company billing its own clients).
-- Identity only — sender, letterhead and contact details; the logic is identical.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS brand text;

-- ---------------------------------------------------------------------------
-- The driver app (phase 2, 2026-08-25)
-- ---------------------------------------------------------------------------
-- A driver signs in by tapping a link texted to their phone: no signup, no
-- password. The account is still a users row (jobs.driver_id points at it), it
-- just gets there without a form. Only the HASH of the link token is stored, so
-- a leaked row is not a key.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_driver        boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_last_seen timestamptz;
CREATE TABLE IF NOT EXISTS driver_links (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  sent_to    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz                       -- single use
);
CREATE INDEX IF NOT EXISTS idx_driver_links_user ON driver_links(user_id);
-- Six digits texted to a driver who signs themselves in. The link is for day
-- one; this is for every day after it.
CREATE TABLE IF NOT EXISTS driver_codes (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  sent_to    text,
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_driver_codes_user ON driver_codes(user_id, created_at DESC);

-- Proof of delivery captured against a JOB (the order-based pod_photos table
-- can't hold a service call — it has no order). pod_ref is the completion that
-- produced it: a phone that finishes a stop with no signal replays the upload
-- later, and the ref is what stops the replay writing a second set of photos.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signature_path text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pod_ref        text;
CREATE TABLE IF NOT EXISTS job_photos (
  id         serial PRIMARY KEY,
  job_id     int NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url        text,
  pathname   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
-- Which batch a photo arrived in. Photos added after a stop was closed out
-- can't share the completion's pod_ref, so they carry their own. Not unique:
-- one batch is several rows sharing a ref.
-- The signed Proof of Delivery form: damage answers, the per-item table, the
-- explanation and the printed name. One jsonb because it is read back, and
-- printed, whole.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pod_form jsonb;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS ref text;
CREATE INDEX IF NOT EXISTS idx_job_photos_ref ON job_photos(job_id, ref);

-- ---------------------------------------------------------------------------
-- Coupon codes, and the affiliates they belong to. One code, one owner: the
-- affiliate lives on the coupon so "what did Dave's code do for us last month"
-- is a query. See lib/coupons.js — the discount that reaches an order is always
-- recomputed server-side from authoritative prices, never taken from the client.
CREATE TABLE IF NOT EXISTS coupons (
  id                serial PRIMARY KEY,
  code              text NOT NULL,
  affiliate         text,
  commission_pct    numeric(5,2) NOT NULL DEFAULT 0,  -- what they earn on it (reporting only)
  kind              text NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','amount')),
  value             numeric(10,2) NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  starts_at         date,
  ends_at           date,
  min_subtotal      numeric(10,2) NOT NULL DEFAULT 0,
  max_uses          int,               -- null = unlimited
  per_email_limit   int,               -- null = unlimited per customer
  exclude_clearance boolean NOT NULL DEFAULT false,
  note              text,
  used_count        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- The code is the identity, case-insensitively, or the affiliate report splits in two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON coupons(upper(code));

-- One row per use. The affiliate is snapshotted here rather than joined, so
-- retiring or reassigning a code later doesn't rewrite history.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id         serial PRIMARY KEY,
  coupon_id  int NOT NULL,
  code       text NOT NULL,
  affiliate  text,
  order_id   int,
  email      text,
  subtotal   numeric(10,2),
  discount   numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order  ON coupon_redemptions(order_id);

-- What a delivery day cost that no single stop did: gas, overwhelmingly, plus
-- tolls, a truck rental, a cash helper. It is DATED rather than timestamped
-- because that is how a receipt behaves — filled in at the pump if somebody is
-- quick, and out of the glovebox on Friday if they aren't — and it is never
-- split across the day's stops, because a tank goes into a van and dividing it
-- per delivery would be a guess dressed up as a figure.
CREATE TABLE IF NOT EXISTS dispatch_expenses (
  id              serial PRIMARY KEY,
  expense_date    date NOT NULL,
  kind            text NOT NULL DEFAULT 'gas',   -- gas | tolls | parking | maintenance | rental | helper | other
  amount          numeric(10,2) NOT NULL,
  driver_id       int,                           -- which van, when it is known
  note            text,
  created_by      text,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_expenses_date ON dispatch_expenses(expense_date);

-- Which van. An odometer reading that doesn't say which truck it came off is not
-- a mileage figure, it's two trucks' numbers in one column.
CREATE TABLE IF NOT EXISTS vehicles (
  id serial PRIMARY KEY,
  name text NOT NULL,
  plate text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The driver's DAY, as distinct from the stops inside it. Time on shift is what
-- a person is paid for; time on site (jobs.time_in/out) is what a delivery
-- costs. Separate on purpose — adding them up would be wrong both ways.
CREATE TABLE IF NOT EXISTS driver_shifts (
  id serial PRIMARY KEY,
  user_id    int NOT NULL,
  vehicle_id int,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz,
  start_km int,
  end_km   int,
  start_lat numeric(9,6), start_lng numeric(9,6),
  end_lat   numeric(9,6), end_lng   numeric(9,6),
  note text,
  ref  text
);
CREATE INDEX IF NOT EXISTS idx_driver_shifts_user ON driver_shifts(user_id, started_at DESC);
-- One open shift per driver, enforced where it can't be argued with: a phone
-- replaying "start shift" off the offline queue must not open a second one and
-- quietly double somebody's hours.
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_shift_open
  ON driver_shifts(user_id) WHERE ended_at IS NULL;

-- Fuel added by a driver on the road lands in the SAME table the office types
-- gas into, so the Profit tab needs no second code path and there are never two
-- sets of fuel figures to reconcile.
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS litres       numeric(8,2);
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS odometer_km  int;
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS vehicle_id   int;
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS shift_id     int;
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS receipt_path text;
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS receipt_url  text;
ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS ref          text;
CREATE INDEX IF NOT EXISTS idx_dispatch_expenses_ref ON dispatch_expenses(ref) WHERE ref IS NOT NULL;
-- Where the vans are. Written by the driver's phone while the app is on screen;
-- a web page cannot report in the background (iOS suspends it the moment the
-- screen locks or the driver switches to Maps), so this is a breadcrumb trail
-- with real gaps in it, not a continuous track.
--
-- `at` is the timestamp the DEVICE recorded, never the moment the row was
-- written. A phone coming back into signal posts twenty minutes of history at
-- once, and stamping those on arrival would tell the office a driver is
-- somewhere they left long ago. Everything that reads this ages the row and
-- refuses to draw an old fix as a current one.
CREATE TABLE IF NOT EXISTS driver_pings (
  id         bigserial PRIMARY KEY,
  user_id    int NOT NULL,
  job_id     int,                      -- the stop they were on, when there was one
  lat        numeric(9,6) NOT NULL,
  lng        numeric(9,6) NOT NULL,
  accuracy_m int,
  speed_kmh  numeric(6,2),
  heading    int,
  source     text NOT NULL DEFAULT 'watch',
  at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_driver_pings_user_at ON driver_pings(user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_pings_at ON driver_pings(at);

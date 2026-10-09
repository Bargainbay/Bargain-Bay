-- Marketplace listings and their photos. See docs/marketplace/PLAN.md §7.
--
-- A vendor's unit is NOT a row in `products`: upsertProducts rewrites every product
-- column on every tracker sync and DEACTIVATES anything the import does not name, so
-- a vendor unit stored there would be delisted by the next sync.
--
-- One row = one physical unit = one SKU. A vendor with twelve identical machines
-- lists twelve; the qty-1 reservation rule is never relaxed.

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id               serial PRIMARY KEY,
  sku              text NOT NULL,
  vendor_id        integer NOT NULL REFERENCES vendors(id),
  lane             text NOT NULL CHECK (lane IN ('A','B','C')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN (
                     'draft','in_review','changes_requested','approved','awaiting_checkin',
                     'live','paused','reserved','sold','rejected','withdrawn')),
  category         text,
  make             text,
  model            text,
  -- private: used to stop duplicate and stolen listings, never shown to customers
  serial_private   text,
  condition        text CHECK (condition IS NULL OR condition IN
                     ('New in Box','New Open Box','New Scratch & Dent','Refurbished')),
  title            text,
  description      text,
  price            numeric(10,2) CHECK (price IS NULL OR price > 0),
  compare_at       numeric(10,2) CHECK (compare_at IS NULL OR compare_at > 0),
  compare_at_source text,
  width_in         numeric(6,1), depth_in numeric(6,1), height_in numeric(6,1), weight_lb numeric(7,1),
  tested_working   boolean NOT NULL DEFAULT false,
  test_notes       text,
  tested_on        date,
  refurb_notes     text,
  -- every unit carries a year, vendor-backed. The database refuses less.
  warranty_months  integer NOT NULL DEFAULT 12 CHECK (warranty_months >= 12),
  delivery_notes   text,
  pickup_address   text, pickup_city text, pickup_postal text,
  attrs            jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  reviewed_by      text,
  reject_code      text,
  review_note      text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_sku ON marketplace_listings (sku);
CREATE INDEX IF NOT EXISTS marketplace_listings_vendor ON marketplace_listings (vendor_id, status);
-- THE DUPLICATE-SERIAL GUARD: the same serial number cannot be in review or for sale
-- twice, across ALL vendors. Partial, so a sold or withdrawn unit frees the serial.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_serial_live
  ON marketplace_listings (lower(btrim(serial_private)))
  WHERE serial_private IS NOT NULL
    AND status IN ('in_review','approved','awaiting_checkin','live','reserved','paused');

CREATE TABLE IF NOT EXISTS listing_photos (
  id          serial PRIMARY KEY,
  listing_id  integer NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  -- 'public' shows in the gallery; 'evidence' (the rating plate) is for our eyes only.
  kind        text NOT NULL DEFAULT 'public' CHECK (kind IN ('public','evidence')),
  role        text NOT NULL DEFAULT 'other' CHECK (role IN
                ('front','back','interior','controls','defect','accessories','other','plate')),
  blob_path   text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  caption     text,
  width       integer, height integer, bytes integer,
  phash       text,
  blur        numeric(8,1),
  warnings    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_photos_listing ON listing_photos (listing_id, position, id);
CREATE INDEX IF NOT EXISTS listing_photos_phash ON listing_photos (phash);

-- Append-only: every transition, with who and why.
CREATE TABLE IF NOT EXISTS listing_events (
  id          serial PRIMARY KEY,
  listing_id  integer NOT NULL REFERENCES marketplace_listings(id),
  event       text NOT NULL,
  actor       text,
  detail      jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_events_listing ON listing_events (listing_id, at);

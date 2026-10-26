-- Vesta Kitchen's range, mirrored from their public Shopify feed (lib/vesta.js).
-- Its OWN table, never `products`: upsertProducts rewrites every column of a tracker row on every sync and
-- deactivates anything the tracker does not carry, so Vesta items put there would be delisted at once.
-- One row per Vesta product (their first, base variant: the paid warranty upgrades are not imported).
CREATE TABLE IF NOT EXISTS vesta_products (
  sku          text PRIMARY KEY,            -- 'VS-<shopify product id>'
  handle       text NOT NULL,
  title        text NOT NULL,
  product_type text,
  category     text NOT NULL,               -- OUR category (a COLLECTIONS entry)
  subcategory  text,                        -- the shop's "Type" filter
  price        numeric(10,2) NOT NULL,
  compare_at   numeric(10,2),
  in_stock     boolean NOT NULL DEFAULT false,
  images       jsonb NOT NULL DEFAULT '[]',
  description  text,
  tags         text[] NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,   -- false = no longer in Vesta's feed
  synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vesta_active ON vesta_products (active, category);

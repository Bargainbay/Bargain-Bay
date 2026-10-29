-- Package deals: a named set of specific units (every unit is one-of-a-kind, so a
-- bundle names SKUs, not models) sold together at one package price. See lib/bundles.js.
CREATE TABLE IF NOT EXISTS bundles (
  id         serial PRIMARY KEY,
  title      text NOT NULL,
  blurb      text NOT NULL DEFAULT '',
  price      numeric(10,2) NOT NULL CHECK (price > 0),
  active     boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id int  NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  sku       text NOT NULL,
  position  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_bundle_items_sku ON bundle_items(sku);

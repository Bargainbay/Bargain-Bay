-- Sales Hub phase 2: the service price catalog (with an INTERNAL cost per service,
-- for live profit on quotes) and who placed a rep hold.
--
-- No rows are seeded here: a migration that seeds data makes a fresh database
-- non-empty and breaks the backup restore tests. The admin editor has an
-- "Add the starting list" button instead.
CREATE TABLE IF NOT EXISTS services (
  id            serial PRIMARY KEY,
  side          text NOT NULL DEFAULT 'rs' CHECK (side IN ('bb', 'rs', 'both')),
  name          text NOT NULL,
  description   text,
  pricing_type  text NOT NULL DEFAULT 'fixed' CHECK (pricing_type IN ('fixed', 'hourly', 'from', 'custom')),
  default_price numeric(10,2),
  -- What it costs US. NULL = nobody has set it yet, which is not the same as zero:
  -- the profit panel says "cost not set" rather than pretending it is free.
  internal_cost numeric(10,2),
  cost_basis    text NOT NULL DEFAULT 'order' CHECK (cost_basis IN ('order', 'unit', 'hour', 'appliance')),
  bookable      boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_name ON services (lower(name)) WHERE active;

-- A rep's hold is a reservation row with no order. Who placed it, and for whom.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS held_by text;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS hold_note text;

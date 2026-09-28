-- When to buy more of a part, and how the list knows to stop nagging.
--
-- THE FIRST HALF OF THIS FILE IS NOT ABOUT REORDERING. `parts`, `part_moves`
-- and `part_requests` are created by ensurePartSchema() at runtime and by no
-- migration, so a database built from migrations alone does not have them and
-- the ALTERs below would have nothing to alter — the same trap 0008 hit with
-- `purchase_invoices`. The definitions are copied from lib/parts.js VERBATIM
-- and are IF NOT EXISTS, so this is a no-op on the live database and three more
-- of the 27 runtime-DDL tables are now covered by migrations.
CREATE TABLE IF NOT EXISTS parts (
  id          serial PRIMARY KEY,
  part_number text,
  name        text NOT NULL,
  brand       text,
  category    text,
  fits        text[],
  note        text,
  created_by  text,
  created_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_number ON parts (upper(part_number))
  WHERE part_number IS NOT NULL AND part_number <> '';
CREATE INDEX IF NOT EXISTS idx_parts_name ON parts (lower(name));

CREATE TABLE IF NOT EXISTS part_moves (
  id        bigserial PRIMARY KEY,
  part_id   int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  qty       int NOT NULL,
  condition text NOT NULL DEFAULT 'used',
  location  text,
  cost      numeric(10,2),
  est_value numeric(10,2),
  reason    text NOT NULL,
  ref       text,
  note      text,
  by        text,
  by_name   text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_part_moves_part ON part_moves(part_id, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_part_moves_ref  ON part_moves(ref);

CREATE TABLE IF NOT EXISTS part_requests (
  id                serial PRIMARY KEY,
  part_id           int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  qty               int NOT NULL DEFAULT 1,
  reason            text,
  job_ref           text,
  status            text NOT NULL DEFAULT 'pending',
  requested_by      text,
  requested_by_name text,
  decided_by        text,
  decided_by_name   text,
  decided_at        timestamptz,
  picked_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_part_requests_open ON part_requests(status, created_at DESC);

-- The reorder point itself.
--
-- NULL is a real answer and means NOBODY HAS SET ONE — not zero. A part with no
-- point is not watched and is reported as unwatched, because defaulting to 0
-- would say every part is fine and defaulting to 1 would say every part is
-- urgent. Same rule as suppliers.terms_days.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS reorder_point int
  CHECK (reorder_point IS NULL OR reorder_point >= 0);
-- How many to buy when it trips. NULL falls back to the point itself, which
-- refills to twice the threshold — a defensible default, and stated on screen.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS reorder_qty int
  CHECK (reorder_qty IS NULL OR reorder_qty > 0);
-- Who we buy it from, so the list can say who to ring. Additive and nullable:
-- a part with no preferred supplier still reorders, it just cannot name one.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS preferred_supplier_id int
  REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_parts_reorder ON parts (reorder_point)
  WHERE reorder_point IS NOT NULL;

-- A purchase order line can now name a PART, not only an appliance.
--
-- Without this there is no way to know a part is already on order, and a list
-- that keeps shouting about something ordered last week is a list people stop
-- reading. Additive: every existing line keeps a NULL part_id and is still an
-- appliance line.
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS part_id int
  REFERENCES parts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_po_lines_part ON purchase_order_lines (part_id)
  WHERE part_id IS NOT NULL;

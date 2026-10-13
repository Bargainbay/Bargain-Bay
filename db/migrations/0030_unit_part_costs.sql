-- Money spent on parts for a specific unit.
--
-- The tracker has a "Parts Cost" column and Total Cost = product + parts +
-- labour, but only 1 unit of 935 ever had a parts cost typed in: nothing made it
-- easy, so repairs were costed at nothing and the sales read as pure profit.
-- This is the record behind that cell. An admin records each part that was
-- actually BOUGHT against the unit's SKU (and, later, RS Ops posts the same when
-- a part is marked ordered); the unit's parts lines are summed and written to
-- the tracker's Parts Cost cell, so Total Cost, the site's product cost and every
-- profit figure follow.
--
-- Rows are never deleted: a mistake is VOIDED, so "what was spent on this unit
-- and who said so" is always answerable.
CREATE TABLE IF NOT EXISTS unit_part_costs (
  id          serial PRIMARY KEY,
  sku         text NOT NULL,
  part_name   text NOT NULL,
  part_number text,
  supplier    text,
  -- PRE-TAX: the HST on a business purchase is recovered, not spent.
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  ordered_on  date NOT NULL DEFAULT CURRENT_DATE,
  -- 'admin' typed here; 'tracker' = a Parts Cost already typed on the tracker
  -- that was adopted so it is not overwritten; 'rsops' = posted by RS Ops.
  source      text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','tracker','rsops')),
  -- RS Ops' own id for the part, so a part posted twice is one row.
  source_ref  text,
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   text
);
CREATE INDEX IF NOT EXISTS unit_part_costs_sku ON unit_part_costs (upper(sku)) WHERE voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unit_part_costs_source_ref ON unit_part_costs (source, source_ref)
  WHERE source_ref IS NOT NULL AND voided_at IS NULL;

-- A carrier's per-kilometre charge on a van: so many free kilometres a day, then a rate per km.
-- NULL = no km billing. (0023_runtime_schema carries the vehicles table itself.)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS km_included int;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS km_rate numeric(8,4);

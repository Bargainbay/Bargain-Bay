-- A third staff role: the business-development rep (the Sales Hub at /sales).
--
-- It is its own role and NOT a widening of 'sales': a plain sales associate stays
-- cost-blind, and only 'sales_rep' (and admin) may be shown a unit's cost. See
-- canSeeCost in lib/auth.js.
--
-- The original CHECK was written inline on the column, so its name is whatever
-- Postgres chose. Drop any CHECK on this table that mentions the role column
-- rather than guessing the name, then add it back with the new value.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'staff_access'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE staff_access DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE staff_access
  ADD CONSTRAINT staff_access_role_check CHECK (role IN ('admin', 'sales', 'sales_rep'));

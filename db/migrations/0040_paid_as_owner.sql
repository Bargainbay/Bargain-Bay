-- An owner who drives is not on a wage: their shift hours are still recorded, but cost nothing and
-- never raise the "no hourly rate" warning on the Profit tab.
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_as_owner boolean NOT NULL DEFAULT false;

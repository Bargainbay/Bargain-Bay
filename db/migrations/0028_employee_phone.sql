-- A mobile for each employee, so the evening "still working?" can reach them on
-- WhatsApp. Optional: where it is blank the question falls back to the phone on
-- their user account (or driver account), so nobody has to be typed in twice.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text;

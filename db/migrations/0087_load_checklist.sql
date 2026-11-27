-- The driver's loading checklist: who ticked each item onto the van, and for
-- which day. A tick counts only while the stop is still on that day, so a stop
-- moved to another day starts unticked.
ALTER TABLE job_items ADD COLUMN IF NOT EXISTS loaded_at  timestamptz;
ALTER TABLE job_items ADD COLUMN IF NOT EXISTS loaded_by  text;
ALTER TABLE job_items ADD COLUMN IF NOT EXISTS loaded_for date;

-- Per-item outcome of a closed delivery stop. true = it went in, false = it stayed
-- on the van (a partial delivery; the order stays open and the rest gets a stop of
-- its own), NULL = nobody said. See lib/jobs.js recordJobItemDelivery.
ALTER TABLE job_items ADD COLUMN IF NOT EXISTS delivered boolean;

-- Lane B: the collection of a vendor-held unit is a dispatch job, booked when the vendor marks the
-- order READY. See docs/marketplace/PLAN.md §4.2 and lib/vendor-pickup.js.
--
-- jobs.vendor_order_id is deliberately NOT jobs.order_id. The customer's order is delivered by the
-- ordinary delivery job; a job carrying order_id would (a) make the board think that order is already
-- on it and (b) mark the CUSTOMER'S order delivered the moment the crew collected from the vendor.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS vendor_order_id integer;
-- one LIVE collection per vendor order, whatever races to create it
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_live_pickup_per_vendor_order
  ON jobs (vendor_order_id) WHERE vendor_order_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS pickup_job_id integer;
-- Our crew has the unit. Recorded off the pickup job; it does NOT touch ready_by / ready_strike_id,
-- because the 72 hours are judged on the vendor marking ready, not on our crew arriving.
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS collected_at timestamptz;
-- The crew found the unit is not what the listing says. Staff decide what happens (strike, refund).
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS mismatch_at timestamptz;
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS mismatch_note text;
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS mismatch_resolved_at timestamptz;
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS mismatch_resolution text;
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS mismatch_resolved_by text;

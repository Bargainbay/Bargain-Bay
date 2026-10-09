-- Marketplace accounting. See docs/marketplace/PLAN.md §4.3 and §8.2.
--
-- A seller's unit rides on the customer's order and invoice, but it is NOT our revenue: the seller
-- is the seller of record and we are the agent. So the order remembers how much of it is the
-- sellers' — their item prices (plus the delivery fee a self-shipping seller keeps most of), and
-- the HST charged on those — and every revenue figure subtracts it. What IS ours is the
-- commission and fees, recognised when the sale is settled (they come from vendor_ledger).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_subtotal numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_hst      numeric(12,2) NOT NULL DEFAULT 0;

-- The HST charged on this seller's part of the order. It is the seller's to remit (they are the
-- seller), so it is paid to them with the sale and is never ours.
ALTER TABLE vendor_orders ADD COLUMN IF NOT EXISTS hst_cents bigint NOT NULL DEFAULT 0 CHECK (hst_cents >= 0);

-- Two more kinds on the vendor's ledger: the HST on their sale that we hand to them, and the HST
-- on OUR fees to them (commission and the delivery service are taxable supplies).
ALTER TABLE vendor_ledger DROP CONSTRAINT IF EXISTS vendor_ledger_kind_check;
ALTER TABLE vendor_ledger DROP CONSTRAINT IF EXISTS vendor_ledger_sign;
ALTER TABLE vendor_ledger ADD CONSTRAINT vendor_ledger_kind_check CHECK (kind IN (
  'sale','lane_c_delivery','commission','delivery_service_fee','insurance',
  'warranty_hold','warranty_release','refund','guarantee_claim','chargeback',
  'adjustment','payout','payout_reversal','hst_on_sale','hst_on_fees'));
ALTER TABLE vendor_ledger ADD CONSTRAINT vendor_ledger_sign CHECK (
  amount_cents <> 0 AND CASE
    WHEN kind IN ('sale','lane_c_delivery','warranty_release','payout_reversal','hst_on_sale') THEN amount_cents > 0
    WHEN kind IN ('commission','delivery_service_fee','insurance','warranty_hold','refund',
                  'guarantee_claim','chargeback','payout','hst_on_fees') THEN amount_cents < 0
    ELSE TRUE END);

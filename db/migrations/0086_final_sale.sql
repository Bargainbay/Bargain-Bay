-- Final sale (owner, 2026-11-27): anything sold for more than 30% off retail. Stamped on the invoice
-- line when the sale is made, so a later change to the tracker's retail price never rewrites it.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS final_sale boolean NOT NULL DEFAULT false;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS retail_price numeric(10,2);

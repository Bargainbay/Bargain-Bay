-- Linking a supplier invoice to the order it bills.
--
-- THE FIRST HALF OF THIS FILE IS NOT ABOUT MATCHING. `purchase_invoices` is
-- created by ensureFinanceSchema() at runtime and by no migration, so a
-- database built from migrations alone does not have it — this ALTER had
-- nothing to alter, which is how the 27-runtime-DDL problem finally bit
-- something. The definition below is copied from lib/finance.js verbatim and is
-- IF NOT EXISTS, so it is a no-op on the live database and the ledger simply
-- starts covering one more table.
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id serial PRIMARY KEY,
  vendor text,
  invoice_number text,
  invoice_date date NOT NULL,
  subtotal numeric(10,2),
  tax numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2),
  units int NOT NULL DEFAULT 0,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS paid_at date;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_invoices_ref
  ON purchase_invoices (lower(COALESCE(vendor,'')), lower(invoice_number))
  WHERE invoice_number IS NOT NULL AND invoice_number <> '';

-- ---------------------------------------------------------------------------
-- THE MATCH IS AT HEADER LEVEL, and that is a real limitation rather than an
-- oversight: purchase_invoices records a vendor, a number, a date, a subtotal,
-- a tax figure, a total and a UNIT COUNT. There is no line-item table, because
-- intake parses the PDF's lines straight into tracker units and keeps only the
-- header for the HST input tax credit.
--
-- So this compares totals and counts, not line against line. It cannot tell you
-- that one fridge on a six-line invoice was priced wrong. It CAN tell you:
--
--   · an invoice arrived for stock nobody ordered,
--   · stock arrived that nobody has billed us for — so its cost never reached
--     the books and no input tax credit was claimed on it,
--   · the units invoiced do not match the units received,
--   · the money invoiced does not match what we agreed to pay.
--
-- Line-level matching needs a purchase_invoice_lines table and a change to
-- intake, and is its own job.
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS po_id int REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS linked_by text;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS linked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_po ON purchase_invoices (po_id) WHERE po_id IS NOT NULL;

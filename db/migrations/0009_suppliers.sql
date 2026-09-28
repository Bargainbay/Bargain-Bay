-- Who we buy from.
--
-- A supplier has been a string typed by hand on every path that touches one:
-- the tracker's Vendor column, consignment_units.vendor, purchase_orders.vendor,
-- purchase_invoices.vendor. So "SecondShop", "Second Shop" and "secondshop " are
-- three suppliers on a report and one company in the driveway, and there is
-- nowhere at all to record their terms, who to ring, or whether they deliver
-- when they say they will.
--
-- THE TEXT STAYS. The master tracker is the source of truth for stock, it is not
-- in this repo, and its Vendor column cannot carry a foreign key — so
-- `supplier_id` is ADDITIVE everywhere and the name is still what is written
-- down. Same shape as customers: the email string is still on the order, and
-- customer_id does not exist.
CREATE TABLE IF NOT EXISTS suppliers (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  -- The folded form, and the identity. Same rule lib/stock-vendors has always
  -- used to group tracker rows: lowercased, punctuation and spaces removed.
  name_key     text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  -- Payment terms in days. NULL means nobody has recorded them — which is NOT
  -- the same as "due on receipt", and the aging view says so rather than
  -- assuming zero and reporting every unpaid invoice as overdue.
  terms_days   int CHECK (terms_days IS NULL OR terms_days >= 0),
  note         text,
  active       boolean NOT NULL DEFAULT true,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_key ON suppliers (name_key);

-- "SS" for SecondShop, "CDA" for Canadian Discount Appliances. Same shape as
-- client_aliases and customer_aliases, and learned the same way: a name that
-- did not match is asked about once, and the answer is kept.
CREATE TABLE IF NOT EXISTS supplier_aliases (
  id          serial PRIMARY KEY,
  supplier_id int NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  alias_key   text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_alias_key ON supplier_aliases (alias_key);

-- Additive. The vendor NAME is still written on both, and still governs.
ALTER TABLE purchase_orders   ADD COLUMN IF NOT EXISTS supplier_id int REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS supplier_id int REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_po_supplier  ON purchase_orders (supplier_id)   WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pi_supplier  ON purchase_invoices (supplier_id) WHERE supplier_id IS NOT NULL;

-- What we have ORDERED, as distinct from what has arrived.
--
-- Until now stock entered the system only when a supplier INVOICE was uploaded.
-- There was no record of what had been ordered, from whom, at what price, or
-- when it was due — so nothing could be chased, nothing was ever "late", and
-- three-way matching (order ↔ receipt ↔ invoice) was impossible.
--
-- That gap is what produced the 2026-09-17 mess: 64 of the 114 appliances RS Ops
-- held were not on the tracker, because nobody had uploaded the invoices that
-- would have put them there. They sold anyway, on typed invoice lines, so
-- nothing marked them sold. The whole stock-reconcile apparatus — NEEDS INVOICE
-- rows, fill requests, the Stock gaps screen — exists to paper over an ordering
-- record that did not exist.
--
-- The important consequence is small to state: AN APPLIANCE NOW EXISTS IN THE
-- SYSTEM FROM THE MOMENT IT IS ORDERED, not from the moment its paperwork
-- turns up.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            serial PRIMARY KEY,
  vendor        text NOT NULL,
  -- THE SUPPLIER'S OWN NUMBER, and it becomes the tracker lot when units are
  -- received (lotForInvoice). The owner's rule from the intake work: a lot is
  -- not renamed, because a minted name means the same delivery ends up under
  -- two of them.
  order_number  text,
  ordered_on    date NOT NULL DEFAULT CURRENT_DATE,
  expected_on   date,
  note          text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  cancelled_by  text
);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders (lower(vendor));
CREATE INDEX IF NOT EXISTS idx_po_expected ON purchase_orders (expected_on) WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id            serial PRIMARY KEY,
  po_id         int NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description   text,
  make          text,
  model         text,
  category      text,
  qty           int NOT NULL DEFAULT 1 CHECK (qty > 0),
  -- What we agreed to pay. This is the whole point: a unit received against a
  -- PO arrives PRICED, so it does not become a NEEDS INVOICE row waiting for an
  -- admin to approve a fill request.
  unit_cost     numeric(10,2),
  retail        numeric(10,2),
  -- Receipts are cumulative, because a supplier sends what they have and the
  -- rest follows. Over-receipt is ALLOWED and visible: refusing it would leave
  -- an appliance that is physically here unbooked, which is the original sin.
  qty_received  int NOT NULL DEFAULT 0 CHECK (qty_received >= 0)
);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines (po_id);

-- Which SKUs came off which line. Without it, receiving twice by accident is
-- indistinguishable from a genuine second delivery.
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id          serial PRIMARY KEY,
  po_id       int NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_id     int NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  qty         int NOT NULL,
  skus        text[],
  received_by text,
  received_at timestamptz NOT NULL DEFAULT now(),
  note        text
);
CREATE INDEX IF NOT EXISTS idx_po_receipts_po ON purchase_order_receipts (po_id, received_at DESC);

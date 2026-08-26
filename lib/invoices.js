// Manual invoicing — DB-backed, no payment processor. The owner builds an
// invoice in /admin/invoices; the customer is emailed an itemized invoice and
// pays by Interac e-transfer (auto-deposit) or in person. The owner marks it
// paid when the money lands, which also records the units in the sold ledger.
// (Replaced the old Stripe Invoicing flow after Stripe paused the account.)
import { hasDb, query, withTransaction } from './db';
import { round2, HST_RATE, money, MAX_RESTOCKING_FEE_PCT } from './constants';
import { markUnitsSold, reverseTrackerSale } from './catalog-sync';
import { sendInvoiceEmail, sendInvoicePaidEmail, sendInvoicePartialPaymentEmail } from './email';
import { createOrderFromInvoice, cancelInvoiceOrder, holdInvoiceSkus } from './orders';
import { upsertCustomer } from './customers';

// Self-provision the fulfilment columns added for the invoice→order bridge, so
// it works on deploy without a manual migration (mirrors db/schema.sql). Cached.
let _invSchema = null;
function ensureInvoiceSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_invSchema) {
    _invSchema = query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_method text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS address  text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS city     text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS postal   text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phone    text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id int;
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text;            -- 'unit' (default) | 'service'
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS warranty_months int;  -- 3 | 6 | 12 | 24, null = no warranty
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2);    -- captured unit cost when not in the tracker
      ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS cost numeric(10,2);    -- effective unit cost on the sale (overrides products.cost)
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_at timestamptz;   -- set when a paid invoice is refunded
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS refunded_at timestamptz; -- set per line on a partial (per-unit) refund
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_total numeric(10,2) NOT NULL DEFAULT 0; -- money returned so far (incl. HST share)
      -- Allow the 'refunded' and 'partial' statuses (the original CHECK only
      -- permitted open/paid/void). 'partial' = some money received (deposit /
      -- instalment) but not the full total — still counts as receivable.
      ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
      ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
        CHECK (status IN ('open','partial','paid','void','refunded'));
      -- Individual payments against an invoice (deposits, instalments, and the
      -- closing balance). The sum of a paid invoice's rows equals its total.
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id serial PRIMARY KEY,
        invoice_id int NOT NULL,
        amount numeric(10,2) NOT NULL,
        method text NOT NULL,
        note text,
        paid_at timestamptz NOT NULL DEFAULT now()
      );
      -- An invoice line can be a service/fee with no unit SKU (Delivery, Install,
      -- ad-hoc). Those must still flow into an order, so order_items.sku must be
      -- nullable — the original NOT NULL silently broke the invoice→order bridge
      -- for any invoice containing a non-inventory line.
      ALTER TABLE order_items ALTER COLUMN sku DROP NOT NULL;
      -- Every dashboard query now asks "is this order backed by a live invoice?"
      -- per order row, as does the 24h abandoned-checkout sweep. Unindexed that
      -- is a sequential scan of invoices for each one.
      CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id) WHERE order_id IS NOT NULL;
      -- Who raised the invoice. The email is the stable identity (it's what the
      -- SALES_EMAILS gate keys off); the name is snapshotted at creation so the
      -- record still reads correctly after someone is renamed or leaves.
      -- Where the invoice came from. 'manual' (a rep in /admin/invoices), 'web'
      -- (raised automatically for a storefront checkout), 'phone', 'quote',
      -- 'salvage'. It matters operationally: a WEB invoice mirrors its order
      -- rather than driving it, and it must not shield an abandoned checkout
      -- from the 24h auto-cancel sweep the way a manual one does.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS channel text;
      -- Which business the invoice goes out as: 'bargain_bay' (the storefront)
      -- or 'rs_solutions' (the delivery/service company). Identity only — the
      -- invoice logic is identical either way.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS brand text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by      text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_name text;
      CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(lower(created_by));
      -- One row per refund event, so "already refunded $840" can always be
      -- explained. invoices.refund_total is the running sum of amount here.
      -- kind: 'items' (units came back) | 'amount' (money-only adjustment)
      -- | 'full' (the whole remaining balance). restocking_fee is money KEPT on
      -- a return (incl. its HST share) — it stays booked as revenue, so a
      -- refund total plus the fees kept is what the customer was charged.
      CREATE TABLE IF NOT EXISTS invoice_refunds (
        id             serial PRIMARY KEY,
        invoice_id     int NOT NULL,
        amount         numeric(10,2) NOT NULL,
        restocking_fee numeric(10,2) NOT NULL DEFAULT 0,
        restocking_pct numeric(5,2)  NOT NULL DEFAULT 0,
        kind           text NOT NULL,
        reason         text,
        created_by     text,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_refunds_invoice ON invoice_refunds(invoice_id);
    `).catch((e) => { _invSchema = null; throw e; });
  }
  return _invSchema;
}

// How a payment was taken.
export const PAYMENT_METHODS = {
  cash: 'Cash',
  etransfer: 'E-transfer',
  card: 'Card (manual)',
  cheque: 'Cheque',
  other: 'Other'
};

function hostedPath(number) {
  return number ? `/invoice/${encodeURIComponent(number)}` : null;
}

// Business days run on Toronto time everywhere else (dashboard bucketing), so
// backdates do too.
function torontoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); // YYYY-MM-DD
}

// Validate an owner-supplied backdate ('YYYY-MM-DD'). Returns the date string,
// or null when it's absent/today (caller falls back to now() — keeps the exact
// timestamp on the normal same-day flow). Future dates and anything older than
// two years are rejected rather than silently clamped.
function normalizeBackdate(input, label = 'date') {
  const s = String(input || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`The ${label} must be a date like 2026-07-08.`);
  const today = torontoToday();
  if (s > today) throw new Error(`The ${label} can't be in the future.`);
  const floor = new Date(Date.now() - 2 * 366 * 24 * 3600 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  if (s < floor) throw new Error(`The ${label} can't be more than two years back.`);
  return s === today ? null : s;
}

// SQL fragment: a 'YYYY-MM-DD' param rendered as noon Toronto time, so the
// timestamp lands mid-day in every dashboard bucket regardless of DST/UTC edges.
const NOON_TORONTO = (param) => `((${param}::text || ' 12:00')::timestamp AT TIME ZONE 'America/Toronto')`;

// items: [{ description, amount, sku?, kind?, warrantyMonths? }] amount in DOLLARS (CAD).
//   kind: 'service' for non-product lines (Installation/Delivery/Door Removal) —
//         these never carry a SKU or a warranty and don't touch inventory.
//   warrantyMonths: 3 | 6 | 12 | 24 (shown on the invoice), null for services.
// sendEmail: email the invoice to the customer (default true); false = create only.
// invoiceDate: optional 'YYYY-MM-DD' backdate for a sale that was rung up late —
//   sets the invoice's issued date (and due date counts from it). Revenue lands on
//   the PAID date, so pass the real date to markInvoicePaid too.
// Fulfilment fields (deliveryMethod/address/city/postal/phone) flow into the order
// created when the invoice is marked paid.
// createdBy: { email, name } of the staff member raising it — the session user,
// or a label for a non-human channel (Sarah takes phone orders). Recorded on the
// invoice AND pushed onto the bridged order's sales_rep, which is what the
// dashboard's per-rep revenue leaderboard reads.
// channel: 'manual' (default) | 'web' | 'phone' | 'quote' | 'salvage'.
// attachToOrderId: link to an EXISTING order instead of raising a new one. That's
//   the storefront path — checkout already created the order and reserved the
//   units, so raising a second order would double-count the sale.
export async function createAndSendInvoice({ name, email, items, addHst, daysUntilDue = 14, memo, deliveryMethod, address, city, postal, phone, sendEmail = true, invoiceDate, createdBy, channel = 'manual', attachToOrderId = null, brand = 'bargain_bay' }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureInvoiceSchema();
  const backdate = normalizeBackdate(invoiceDate, 'invoice date');

  const WARRANTY = new Set([3, 6, 12, 24]);
  const lineItems = (items || [])
    .map((it) => {
      const service = it.kind === 'service';
      const wm = Number(it.warrantyMonths);
      const cost = Number(it.cost);
      return {
        description: String(it.description || '').trim().slice(0, 500),
        amount: round2(Number(it.amount)),
        sku: service ? null : (String(it.sku || '').trim() || null),
        kind: service ? 'service' : 'unit',
        warrantyMonths: service ? null : (WARRANTY.has(wm) ? wm : null),
        // Captured unit cost (for a unit not cost-linked in the catalog) so margin
        // is right. null for services / when not supplied.
        cost: service ? null : (Number.isFinite(cost) && cost >= 0 ? round2(cost) : null)
      };
    })
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const hst = addHst ? round2(subtotal * HST_RATE) : 0;
  const total = round2(subtotal + hst);
  const days = Math.min(Math.max(parseInt(daysUntilDue, 10) || 14, 1), 90);

  // Who raised it. Falls back to nulls rather than guessing — an unattributed
  // invoice reads as "—" instead of being credited to the wrong person.
  const author = {
    email: String(createdBy?.email || '').trim().toLowerCase() || null,
    name: String(createdBy?.name || '').trim() || null
  };
  // A display label for the rep leaderboard: their name if we have one, else the
  // local part of the email (nobody wants "roushisharafmp@gmail.com" on a chart).
  const repLabel = author.name || (author.email ? author.email.split('@')[0] : null);

  const invoice = await withTransaction(async (client) => {
    // A backdated invoice gets created_at = noon Toronto on that day (so it sorts
    // and displays as issued then) and its due date counts from that day too.
    const { rows } = await client.query(
      `INSERT INTO invoices (email, name, status, subtotal, hst, total, memo, due_date,
                             delivery_method, address, city, postal, phone, created_at,
                             created_by, created_by_name, channel, brand)
       VALUES ($1,$2,'open',$3,$4,$5,$6,
               (COALESCE($13::date, (now() AT TIME ZONE 'America/Toronto')::date) + ($7 || ' days')::interval)::date,
               $8,$9,$10,$11,$12, COALESCE(${NOON_TORONTO('$13')}, now()),
               $14,$15,$16,$17)
       RETURNING id`,
      [email, name || null, subtotal, hst, total, memo || null, String(days),
       deliveryMethod === 'delivery' ? 'delivery' : 'pickup', address || null, city || null, postal || null, phone || null,
       backdate, author.email, author.name, channel,
       brand === 'rs_solutions' ? 'rs_solutions' : 'bargain_bay']
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE invoices SET number = 'INV-' || (1000 + id) WHERE id = $1 RETURNING number, due_date`,
      [id]
    );
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, warranty_months, cost) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, li.description, li.sku, li.amount, li.kind, li.warrantyMonths, li.cost]
      );
    }
    const { rows: made } = await client.query('SELECT created_at FROM invoices WHERE id = $1', [id]);
    return { id, number: num[0].number, dueDate: num[0].due_date, name, email, subtotal, hst, total, memo,
             deliveryMethod: deliveryMethod === 'delivery' ? 'delivery' : 'pickup', address, city, postal, phone,
             createdAt: made[0]?.created_at || null,
             brand: brand === 'rs_solutions' ? 'rs_solutions' : 'bargain_bay',
             items: lineItems };
  });

  // Raise the fulfilment order NOW, not at payment. Three things follow from it:
  //   * the sale has a BB- number from the moment it's written, so it's findable
  //     and the warehouse can schedule a delivery against a deposit;
  //   * it lands on the revenue dashboard dated to the invoice, which is what
  //     makes a deposit-now/balance-on-delivery sale count on the day it happened;
  //   * its units come off bargainbay.ca straight away.
  // It sits in 'pending_payment' until the money is in (markInvoicePaid flips it
  // to 'confirmed'), and the units are held by a long reservation rather than by
  // the order's status — so nothing here tells the rest of the system it's sold.
  // Best-effort: a hiccup must never cost us the invoice record itself, and the
  // Sync button / nightly sweep backfills a missing order.
  let orderNumber = null;
  let contested = [];
  // orders.sales_rep is what the dashboard's per-rep revenue leaderboard reads.
  // Nothing populated it before, which is why that panel has always been empty.
  const stampRep = async (orderId, keepExisting) => {
    if (!repLabel) return;
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text').catch(() => {});
    await query(
      keepExisting
        ? 'UPDATE orders SET sales_rep = COALESCE(sales_rep, $2) WHERE id = $1'
        : 'UPDATE orders SET sales_rep = $2 WHERE id = $1',
      [orderId, repLabel]
    ).catch(() => {});
  };

  if (attachToOrderId) {
    // Storefront path: checkout already created the order and already holds its
    // units, so link to it rather than raising a second one — another order would
    // book the same sale twice. The order stays the source of truth here and this
    // invoice mirrors its status (see mirrorOrderToWebInvoice).
    try {
      await query('UPDATE invoices SET order_id = $2 WHERE id = $1', [invoice.id, attachToOrderId]);
      const { rows: o } = await query('SELECT order_number FROM orders WHERE id = $1', [attachToOrderId]);
      orderNumber = o[0]?.order_number || null;
      await stampRep(attachToOrderId, true);
    } catch (e) {
      console.error('invoice→existing order link failed', e.message);
    }
  } else {
    try {
      const order = await createOrderFromInvoice(
        { invoiceNumber: invoice.number, email, name, phone,
          deliveryMethod: invoice.deliveryMethod, address, city, postal,
          subtotal, hst, total, paymentMethod: null,
          items: lineItems.map((li) => ({ sku: li.sku, title: li.description, price: li.amount, cost: li.cost })) },
        { status: 'pending_payment', createdAt: invoice.createdAt, holdSkus: true }
      );
      orderNumber = order.orderNumber;
      contested = order.contested || [];
      await query('UPDATE invoices SET order_id = $2 WHERE id = $1', [invoice.id, order.id]);
      await stampRep(order.id, false);
    } catch (e) {
      console.error('invoice order creation failed', e.message);
    }
  }

  // Email the customer their invoice + e-transfer instructions, unless the owner
  // opted out (e.g. an in-person sale). Best-effort — never fail the create if
  // mail hiccups; the owner still has the record. MUST be awaited: on Vercel an
  // un-awaited promise freezes with the function and only resumes on the next
  // invocation — which is why invoice emails used to arrive at mark-paid time.
  if (sendEmail) await sendInvoiceEmail(invoice).catch((e) => console.error('invoice email failed', e.message));

  // Fold the invoiced client into the customer database. Best-effort.
  await upsertCustomer({ email, name, phone, address, city, postal })
    .catch((e) => console.error('customer upsert failed', e.message));

  return {
    id: invoice.id, number: invoice.number, total, status: 'open', email,
    emailed: !!sendEmail, hostedUrl: hostedPath(invoice.number),
    orderNumber, createdBy: author.email, createdByName: repLabel,
    // SKUs that were already held/sold elsewhere — the invoice stands, but the
    // unit is double-booked and somebody needs to know.
    contested
  };
}

// Web-sale mirroring lives in ./web-invoices (own module to avoid an import
// cycle: this file imports ./orders, which needs those helpers). Re-exported
// here so callers can keep reaching for them in the obvious place.
export { mirrorOrderToWebInvoice, voidWebInvoicesForOrders } from './web-invoices';

// A customer's own invoices, for their account page.
export async function invoicesForEmail(email) {
  if (!hasDb()) return [];
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT id, number, status, total, refund_total, due_date, created_at FROM invoices
      WHERE lower(email) = lower($1) AND number IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
    [String(email || '').trim()]
  );
  return rows.map((r) => ({
    id: r.id, number: r.number, status: r.status, total: Number(r.total) || 0,
    refunded: Number(r.refund_total || 0),
    due: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
    created: r.created_at ? r.created_at.toISOString() : null
  }));
}

// Lightweight observability for ops/monitoring: how invoices and orders break
// down by status, and whether each paid invoice has its fulfilment order. No
// customer data — just counts, so it's safe to surface in the cron response.
export async function invoiceOrderStats() {
  if (!hasDb()) return null;
  await ensureInvoiceSchema();
  const inv = (await query("SELECT status, COUNT(*) c FROM invoices GROUP BY status").catch(() => ({ rows: [] }))).rows;
  const ord = (await query("SELECT status, COUNT(*) c FROM orders GROUP BY status").catch(() => ({ rows: [] }))).rows;
  const paidNoOrder = (await query("SELECT COUNT(*) c FROM invoices WHERE status='paid' AND order_id IS NULL").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  const paidWithOrder = (await query("SELECT COUNT(*) c FROM invoices WHERE status='paid' AND order_id IS NOT NULL").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  const fromInvoices = (await query("SELECT COUNT(*) c FROM orders WHERE notes LIKE 'Created from invoice%'").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  return {
    invoicesByStatus: Object.fromEntries(inv.map((r) => [r.status, Number(r.c)])),
    ordersByStatus: Object.fromEntries(ord.map((r) => [r.status, Number(r.c)])),
    paidInvoicesWithOrder: Number(paidWithOrder),
    paidInvoicesMissingOrder: Number(paidNoOrder),
    ordersFromInvoices: Number(fromInvoices)
  };
}

// Statuses the invoice list can be filtered to. 'unpaid' is a meta-status: an
// invoice with money still owing, whether nothing has been paid yet ('open') or
// only a deposit has ('partial'). That's the "who still owes us?" view.
export const INVOICE_FILTERS = {
  '': 'All statuses',
  unpaid: 'Unpaid (open + deposit)',
  open: 'Open — nothing paid',
  partial: 'Partly paid (deposit)',
  paid: 'Paid in full',
  refunded: 'Refunded',
  void: 'Void'
};

// Everyone who has raised an invoice, for the "raised by" filter. Keyed by email
// (the stable identity) with the friendliest name we've recorded for them.
export async function listInvoiceAuthors() {
  if (!hasDb()) return [];
  await ensureInvoiceSchema();
  try {
    const { rows } = await query(
      `SELECT lower(created_by) AS email,
              COALESCE(MAX(NULLIF(created_by_name,'')), split_part(lower(created_by), '@', 1)) AS name,
              COUNT(*) AS n
         FROM invoices
        WHERE COALESCE(created_by,'') <> ''
        GROUP BY lower(created_by)
        ORDER BY n DESC`
    );
    return rows.map((r) => ({ email: r.email, name: r.name, count: Number(r.n) || 0 }));
  } catch (e) {
    console.error('listInvoiceAuthors failed', e.message);
    return [];
  }
}

// Search + filter across EVERY invoice, not just the recent ones. Matches the
// invoice number, its BB order number, the customer's name / email / phone, the
// memo, and any line item's description or SKU — so an old part-paid invoice is
// findable by the appliance on it even when nobody remembers the number.
// Phone matching compares digits only, so "(647) 943-7714", "6479437714" and
// "943 7714" all find the same customer.
// opts: { q, status, limit, offset }. A bare number is still accepted as `limit`
// so existing callers keep working.
export async function listInvoices(opts = {}) {
  const o = typeof opts === 'number' ? { limit: opts } : (opts || {});
  const q = String(o.q || '').trim().toLowerCase();
  const status = INVOICE_FILTERS[o.status] !== undefined ? String(o.status || '') : '';
  const rep = String(o.rep || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 25, 1), 200);
  const offset = Math.max(parseInt(o.offset, 10) || 0, 0);
  const empty = { invoices: [], total: 0, owing: 0, hasMore: false };
  if (!hasDb()) return empty;
  await ensureInvoiceSchema();

  const like = q ? `%${q}%` : '';
  // Digits-only needle for phone matching; ignored unless the query has 3+ digits
  // (so "007" in a SKU doesn't start matching every phone number).
  const digits = q.replace(/\D/g, '');
  const phoneLike = digits.length >= 3 ? `%${digits}%` : '';

  // $1 = like ('' disables the text match), $2 = phoneLike, $3 = status filter,
  // $4 = rep filter (an author's email, or 'unattributed').
  const where = `
    ($1 = '' OR (
         lower(coalesce(i.number,'')) LIKE $1
      OR lower(coalesce(o.order_number,'')) LIKE $1
      OR lower(coalesce(i.name,'')) LIKE $1
      OR lower(coalesce(i.email,'')) LIKE $1
      OR lower(coalesce(i.memo,'')) LIKE $1
      OR lower(coalesce(i.created_by,'')) LIKE $1
      OR lower(coalesce(i.created_by_name,'')) LIKE $1
      OR ($2 <> '' AND regexp_replace(coalesce(i.phone,''), '\\D', '', 'g') LIKE $2)
      OR EXISTS (SELECT 1 FROM invoice_items ii
                  WHERE ii.invoice_id = i.id
                    AND (lower(ii.description) LIKE $1 OR lower(coalesce(ii.sku,'')) LIKE $1))
    ))
    AND ($3 = ''
         OR ($3 = 'unpaid' AND i.status IN ('open','partial'))
         OR i.status = $3)
    AND ($4 = ''
         OR ($4 = 'unattributed' AND COALESCE(i.created_by,'') = '')
         OR lower(coalesce(i.created_by,'')) = $4)`;

  const { rows } = await query(
    `SELECT i.id, i.number, i.email, i.name, i.status, i.total, i.refund_total, i.payment_method,
            i.due_date, i.paid_at, i.created_at,
            i.created_by, i.created_by_name, i.brand,
            o.order_number AS order_number,
            (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS amount_paid,
            (SELECT COALESCE(json_agg(json_build_object(
                'id', p.id, 'amount', p.amount, 'method', p.method,
                'date', to_char(p.paid_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD')
              ) ORDER BY p.paid_at, p.id), '[]'::json)
              FROM invoice_payments p WHERE p.invoice_id = i.id) AS payments
       FROM invoices i
       LEFT JOIN orders o ON o.id = i.order_id
      WHERE ${where}
      ORDER BY i.created_at DESC
      LIMIT $5 OFFSET $6`,
    [like, phoneLike, status, rep, limit + 1, offset]
  );

  // One extra row tells us whether there's another page without a second count.
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Totals for the WHOLE filtered set (not just this page), so the header can say
  // "18 invoices · $12,430 still owing" while showing 25 at a time.
  let total = 0;
  let owing = 0;
  try {
    const { rows: agg } = await query(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(
                CASE WHEN i.status IN ('open','partial')
                     THEN i.total - (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id)
                     ELSE 0 END
              ),0) AS owing
         FROM invoices i
         LEFT JOIN orders o ON o.id = i.order_id
        WHERE ${where}`,
      [like, phoneLike, status, rep]
    );
    total = Number(agg[0]?.n) || 0;
    owing = round2(Number(agg[0]?.owing) || 0);
  } catch (e) { console.error('invoice list totals failed', e.message); }

  return {
    invoices: page.map((r) => ({
      id: r.id,
      number: r.number || '(draft)',
      email: r.email,
      name: r.name,
      total: Number(r.total) || 0,
      refundedTotal: Number(r.refund_total) || 0,
      amountPaid: Number(r.amount_paid) || 0,
      balance: round2(Math.max(0, (Number(r.total) || 0) - (Number(r.amount_paid) || 0))),
      payments: (Array.isArray(r.payments) ? r.payments : []).map((p) => ({ id: p.id, amount: Number(p.amount) || 0, method: p.method, date: p.date })),
      status: r.status,
      method: r.payment_method,
      hostedUrl: hostedPath(r.number),
      orderNumber: r.order_number || null,
      // Who raised it. The name is the creation-time snapshot; fall back to the
      // email's local part so an older invoice still shows a person, not a blank.
      brand: r.brand || 'bargain_bay',
      createdBy: r.created_by || null,
      createdByName: r.created_by_name || (r.created_by ? String(r.created_by).split('@')[0] : null),
      due: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
      created: r.created_at ? r.created_at.toISOString() : null
    })),
    total,
    owing,
    hasMore
  };
}

export async function getInvoiceByNumber(number) {
  if (!hasDb()) return null;
  await ensureInvoiceSchema(); // items select includes refunded_at — make sure it exists
  const { rows } = await query('SELECT * FROM invoices WHERE number = $1', [number]);
  if (!rows.length) return null;
  const inv = rows[0];
  const { rows: items } = await query(
    'SELECT id, description, sku, amount, kind, warranty_months, refunded_at FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [inv.id]
  );
  // Payments to date (deposits / instalments / closing balance) — lets the hosted
  // invoice and callers show "paid so far" and the outstanding balance.
  let payments = [];
  try {
    const { rows: pays } = await query(
      'SELECT id, amount, method, note, paid_at FROM invoice_payments WHERE invoice_id = $1 ORDER BY paid_at, id',
      [inv.id]
    );
    payments = pays.map((p) => ({ id: p.id, amount: Number(p.amount) || 0, method: p.method, note: p.note, paidAt: p.paid_at }));
  } catch { /* table provisions on first write */ }
  const amountPaid = round2(payments.reduce((a, p) => a + p.amount, 0));
  return { ...inv, items, payments, amountPaid, balance: round2(Math.max(0, (Number(inv.total) || 0) - amountPaid)) };
}

// Mark an invoice paid (e-transfer / cash / etc.) and record how. Marking paid
// ALWAYS registers the sale as confirmed revenue: it delists the units and
// guarantees a confirmed fulfilment order exists (that order is what the revenue
// dashboard counts). This holds no matter the path — a fresh open→paid flip, an
// invoice created and paid in one go, or re-confirming one that's already paid.
// The order step is idempotent (invoices.order_id) so it never duplicates.
// paidDate: optional 'YYYY-MM-DD' — when the money actually landed (backdated
// sale). The bridged order is dated to paid_at, so this is what puts the revenue
// on the right day. On an ALREADY-paid invoice a paidDate re-dates the payment
// (and moves its order), fixing a sale recorded on the wrong day.
export async function markInvoicePaid(invoiceId, methodKey, paidDate) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const label = PAYMENT_METHODS[methodKey] || 'Other';
  const backdate = normalizeBackdate(paidDate, 'payment date');

  // Flip open/partial→paid (records method + paid_at). If it was already paid
  // this is a no-op, but we still ensure the order below so the sale always counts.
  const { rows: flip } = await query(
    `UPDATE invoices SET status = 'paid', payment_method = $2,
            paid_at = COALESCE(${NOON_TORONTO('$3')}, now())
      WHERE id = $1 AND status IN ('open','partial') RETURNING id`,
    [invoiceId, label, backdate]
  );
  const justPaid = flip.length > 0;

  // Book the closing payment so the payment ledger always sums to the total —
  // the remaining balance for a partially-paid invoice, or the whole total when
  // it's paid in one go. Best-effort: the flip above is the source of truth.
  if (justPaid) {
    try {
      const { rows: bal } = await query(
        `SELECT total - (SELECT COALESCE(SUM(amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS balance
           FROM invoices i WHERE i.id = $1`, [invoiceId]
      );
      const remaining = round2(Number(bal[0]?.balance) || 0);
      if (remaining > 0.005) {
        await query(
          `INSERT INTO invoice_payments (invoice_id, amount, method, paid_at)
           VALUES ($1, $2, $3, COALESCE(${NOON_TORONTO('$4')}, now()))`,
          [invoiceId, remaining, label, backdate]
        );
      }
    } catch (e) { console.error('closing payment record failed', e.message); }
  }

  const { rows: cur } = await query(
    'SELECT id, number, status, order_id, email, name, delivery_method, subtotal, hst, total FROM invoices WHERE id = $1',
    [invoiceId]
  );
  if (!cur.length) throw new Error('Invoice not found.');
  const iv = cur[0];
  // A void/refunded invoice can't be "paid" — surface its state, change nothing.
  if (iv.status !== 'paid') {
    return { id: iv.id, number: iv.number, status: iv.status, method: label, soldSkus: 0, orderNumber: null };
  }

  // Re-dating an already-paid invoice moves paid_at only. Revenue is bucketed on
  // the order's date, which now tracks the invoice's ISSUE date — when the sale
  // was made — so correcting when the money landed no longer shifts the sale into
  // another period. Use the invoice date (Edit invoice) to move the sale itself.
  if (!justPaid && backdate) {
    await query(`UPDATE invoices SET paid_at = ${NOON_TORONTO('$2')} WHERE id = $1`, [invoiceId, backdate]);
  }

  // Delist the units (only on the actual flip — they're already sold on a re-mark).
  let soldSkus = 0;
  if (justPaid) {
    try {
      const { rows: its } = await query('SELECT sku, amount FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL', [invoiceId]);
      const prices = Object.fromEntries(its.map((x) => [x.sku, Number(x.amount) || null]));
      const r = await markUnitsSold(its.map((x) => x.sku), { channel: 'invoice', ref: iv.number, prices });
      soldSkus = r.sold;
    } catch (e) {
      console.error('markUnitsSold (invoice) failed', e.message);
    }
  }

  // Settle the fulfilment order. Since invoices raise their order up front this is
  // normally just a status flip: 'pending_payment' → 'confirmed', stamping how it
  // was paid. The unit no longer needs its reservation once the order's own status
  // marks it unavailable, so the hold is released. Invoices predating the up-front
  // bridge have no order at all — backfillInvoiceOrder still covers those, and the
  // per-invoice "+ Add to dashboard" / Sync button is the retry net either way.
  // Best-effort: a hiccup here must not block the payment record.
  let orderNumber = null;
  try {
    if (iv.order_id) {
      await query(
        `UPDATE orders SET status = 'confirmed', payment_method = COALESCE(payment_method, $2)
          WHERE id = $1 AND status IN ('pending_payment','confirmed')`,
        [iv.order_id, label]
      );
      await query('DELETE FROM reservations WHERE order_id = $1', [iv.order_id]).catch(() => {});
      const { rows: o } = await query('SELECT order_number FROM orders WHERE id = $1', [iv.order_id]);
      orderNumber = o[0]?.order_number || null;
    } else {
      const r = await backfillInvoiceOrder(invoiceId);
      orderNumber = r.orderNumber;
    }
  } catch (e) {
    console.error('invoice→order bridge failed', e.message);
  }

  // Payment-received receipt (only on the actual open→paid flip, never on a
  // re-mark/re-date). A receipt with wait-for-pickup/delivery instructions —
  // the payment-request email went out at creation. Awaited (Vercel freeze).
  if (justPaid && iv.email) {
    try {
      const { rows: lineRows } = await query(
        'SELECT description, amount FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [invoiceId]
      );
      await sendInvoicePaidEmail({
        brand: iv.brand,
        number: iv.number, email: iv.email, name: iv.name,
        deliveryMethod: iv.delivery_method, hst: iv.hst, total: iv.total,
        items: lineRows
      });
    } catch (e) {
      console.error('invoice paid email failed', e.message);
    }
  }

  return { id: iv.id, number: iv.number, status: 'paid', method: label, soldSkus, orderNumber };
}

// Record a PARTIAL payment (deposit / instalment) against an open or partially-
// paid invoice. Money is logged in invoice_payments and the invoice moves to
// 'partial'; when the payments reach the total, the invoice is marked fully paid
// through markInvoicePaid (delist + fulfilment order + receipt) with this
// payment's method/date. Revenue still counts only at FULL payment (that's when
// the order exists) — until then the balance shows in "cash in the pipeline".
// paidDate: optional 'YYYY-MM-DD' backdate for money that landed earlier.
export async function recordInvoicePayment(invoiceId, { amount, method, paidDate, note } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const label = PAYMENT_METHODS[method];
  if (!label) throw new Error(`Pick a valid payment method: ${Object.keys(PAYMENT_METHODS).join(', ')}.`);
  const amt = round2(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('The payment amount must be a positive dollar figure.');
  const backdate = normalizeBackdate(paidDate, 'payment date');

  const { rows } = await query(
    `SELECT i.id, i.number, i.status, i.email, i.name, i.total,
            (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS paid_so_far
       FROM invoices i WHERE i.id = $1`, [invoiceId]
  );
  if (!rows.length) throw new Error('Invoice not found.');
  const iv = rows[0];
  if (iv.status === 'paid') throw new Error(`${iv.number} is already fully paid — nothing owing. To reverse money, use a refund.`);
  if (iv.status !== 'open' && iv.status !== 'partial') throw new Error(`${iv.number} is ${iv.status} — payments can only be recorded on an open invoice.`);

  const total = round2(Number(iv.total) || 0);
  const paidSoFar = round2(Number(iv.paid_so_far) || 0);
  const balance = round2(total - paidSoFar);
  if (amt > balance + 0.005) {
    throw new Error(`That's more than the ${money(balance)} still owing on ${iv.number} — record up to the balance (use a refund to return money).`);
  }

  // Payment covers the whole balance → this IS the full payment; markInvoicePaid
  // books the closing payment row itself, so don't insert it twice here.
  if (amt >= balance - 0.005) {
    const full = await markInvoicePaid(invoiceId, method, paidDate);
    return { ...full, amountPaid: total, balance: 0, fullyPaid: true };
  }

  await query(
    `INSERT INTO invoice_payments (invoice_id, amount, method, note, paid_at)
     VALUES ($1, $2, $3, $4, COALESCE(${NOON_TORONTO('$5')}, now()))`,
    [invoiceId, amt, label, String(note || '').trim() || null, backdate]
  );
  await query(`UPDATE invoices SET status = 'partial' WHERE id = $1 AND status = 'open'`, [invoiceId]);

  const newPaid = round2(paidSoFar + amt);
  const newBalance = round2(total - newPaid);

  // Receipt for the deposit — shows what's been received and what's still owing.
  // Best-effort; the payment record above is the source of truth.
  if (iv.email) {
    try {
      await sendInvoicePartialPaymentEmail({
        brand: iv.brand,
        number: iv.number, email: iv.email, name: iv.name,
        amount: amt, method: label, amountPaid: newPaid, balance: newBalance, total
      });
    } catch (e) { console.error('partial payment email failed', e.message); }
  }

  return { id: iv.id, number: iv.number, status: 'partial', method: label, amount: amt, amountPaid: newPaid, balance: newBalance, fullyPaid: false };
}

// Remove a payment recorded in error (fat-fingered amount, double-entry) from an
// open/partially-paid invoice. Only while the invoice isn't settled — a PAID
// invoice's ledger is locked (reverse money with a refund instead). If no
// payments remain the invoice returns to plain 'open'.
export async function voidInvoicePayment(invoiceId, paymentId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query('SELECT id, number, status, total FROM invoices WHERE id = $1', [invoiceId]);
  if (!rows.length) throw new Error('Invoice not found.');
  const iv = rows[0];
  if (iv.status !== 'open' && iv.status !== 'partial') {
    throw new Error(`${iv.number} is ${iv.status} — its payment ledger is locked. Use a refund to reverse money on a paid invoice.`);
  }
  const { rows: gone } = await query(
    'DELETE FROM invoice_payments WHERE id = $1 AND invoice_id = $2 RETURNING amount, method',
    [Number(paymentId), invoiceId]
  );
  if (!gone.length) throw new Error('That payment record was not found on this invoice.');
  const { rows: sum } = await query('SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments WHERE invoice_id = $1', [invoiceId]);
  const paid = round2(Number(sum[0].paid) || 0);
  await query(`UPDATE invoices SET status = $2 WHERE id = $1`, [invoiceId, paid > 0 ? 'partial' : 'open']);
  return {
    id: iv.id, number: iv.number, removed: round2(Number(gone[0].amount) || 0), method: gone[0].method,
    amountPaid: paid, balance: round2(Math.max(0, (Number(iv.total) || 0) - paid)), status: paid > 0 ? 'partial' : 'open'
  };
}

// Void an open invoice (created in error). Leaves a record, and reverses the
// fulfilment order raised when the invoice was written: cancelling it takes the
// money back off the revenue dashboard and releasing its hold relists the units
// on bargainbay.ca. Only 'open' — an invoice that has taken a deposit is
// 'partial' and must have that money dealt with (remove the payment, or refund)
// rather than being quietly voided.
export async function voidInvoice(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  // Explain the blocked cases instead of returning a bare "can't". A partly-paid
  // invoice is the one people actually hit: it has real money against it, and
  // voiding would leave a payment recorded against a cancelled sale.
  const { rows: cur } = await query(
    `SELECT i.id, i.number, i.status,
            (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS paid
       FROM invoices i WHERE i.id = $1`, [invoiceId]
  );
  if (!cur.length) throw new Error('Invoice not found.');
  const now = cur[0];
  const paid = round2(Number(now.paid) || 0);
  if (now.status === 'partial' || paid > 0) {
    throw new Error(
      `${now.number} has ${money(paid)} paid against it. Remove that payment first if it was entered in error ` +
      `(the ✕ beside it on the invoice list), or mark the invoice paid and refund it if the money really was taken — ` +
      `then it can be voided.`
    );
  }
  if (now.status === 'paid') throw new Error(`${now.number} is paid — refund it rather than voiding it.`);
  if (now.status !== 'open') throw new Error(`${now.number} is already ${now.status}.`);

  const { rows } = await query(
    "UPDATE invoices SET status = 'void' WHERE id = $1 AND status = 'open' RETURNING id, number, order_id",
    [invoiceId]
  );
  if (!rows.length) return null;
  const inv = rows[0];
  const { cancelled } = await cancelInvoiceOrder(inv.order_id);
  return { id: inv.id, number: inv.number, orderCancelled: cancelled };
}

// ---- Refunds -------------------------------------------------------------
//
// Three shapes of refund, one ledger. Each writes an `invoice_refunds` row and
// moves `invoices.refund_total`, and each takes the money OFF the bridged
// fulfilment order — which is what makes the dashboard self-correct in the month
// of the ORIGINAL sale, with no second record anywhere.
//
//   refundInvoiceItems  — unit(s) came back: relists them and takes their money
//                         off the order. May keep a restocking fee.
//   refundInvoice       — the whole remaining balance, same treatment.
//   refundInvoiceAmount — money only: a price adjustment, a goodwill credit, a
//                         part of an e-transfer sent back. Moves NO stock, ever.
//
// A **restocking fee** is money we KEEP when the return is the customer's own
// change of mind (published policy: 20%, `RESTOCKING_FEE_PCT`). It has to stay
// booked as revenue, so the returned line comes off the order and a "Restocking
// fee" line goes on in its place — the order still totals what we actually
// earned, dated to when we earned it.

// Clamp an owner-entered restocking percentage. 0 (or anything unparseable) =
// no fee, which is the plain refund the site has always done.
export function clampRestockingPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_RESTOCKING_FEE_PCT, round2(n));
}

// Split a returned amount into what goes back and what we keep. `base` is the
// pre-tax value of the goods coming back; HST follows the money on both halves,
// because a restocking fee is itself a taxable supply in Ontario.
function splitRestocking(base, pct, hasHst) {
  const p = clampRestockingPct(pct);
  const keptBase = round2(base * (p / 100));
  const refundBase = round2(base - keptBase);
  const refundHst = hasHst ? round2(refundBase * HST_RATE) : 0;
  const keptHst = hasHst ? round2(keptBase * HST_RATE) : 0;
  return {
    pct: p, keptBase, refundBase, refundHst, keptHst,
    refundAmount: round2(refundBase + refundHst),
    feeKept: round2(keptBase + keptHst)
  };
}

// Append to the refund ledger. Best-effort by design: the money movement above
// it is the source of truth, and losing the audit line must never fail a refund
// the owner has already handed over at the counter.
async function logRefund(invoiceId, { amount, fee = 0, pct = 0, kind, reason, by }) {
  await query(
    `INSERT INTO invoice_refunds (invoice_id, amount, restocking_fee, restocking_pct, kind, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [invoiceId, round2(amount), round2(fee), clampRestockingPct(pct), kind,
     String(reason || '').trim().slice(0, 300) || null, String(by || '').trim().toLowerCase() || null]
  ).catch((e) => console.error('refund ledger write failed', e.message));
}

// Every refund taken against an invoice, newest first (the "already refunded
// $840" figure on the invoice has to be explainable).
export async function listInvoiceRefunds(invoiceId) {
  if (!hasDb()) return [];
  await ensureInvoiceSchema();
  try {
    const { rows } = await query(
      `SELECT id, amount, restocking_fee, restocking_pct, kind, reason, created_by, created_at
         FROM invoice_refunds WHERE invoice_id = $1 ORDER BY created_at DESC, id DESC`,
      [invoiceId]
    );
    return rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount) || 0,
      restockingFee: Number(r.restocking_fee) || 0,
      restockingPct: Number(r.restocking_pct) || 0,
      kind: r.kind,
      reason: r.reason || '',
      by: r.created_by || null,
      at: r.created_at ? r.created_at.toISOString() : null
    }));
  } catch {
    return [];
  }
}

// Put the kept restocking fee onto the order as its own line, so the order's
// items still add up to its subtotal and the fee is legible on the packing
// slip / order page instead of being an unexplained difference in the totals.
async function addRestockingFeeLine(client, orderId, label, keptBase) {
  if (!(keptBase > 0)) return;
  await client.query(
    'INSERT INTO order_items (order_id, sku, title, price) VALUES ($1, null, $2, $3)',
    [orderId, label.slice(0, 200), keptBase]
  );
}

// Refund a PAID invoice in full (customer returned everything / sale reversed).
// Relists each unit on the storefront and cancels the linked fulfilment order,
// then marks the invoice 'refunded'. It cancels the invoice's OWN bridged order
// directly (so refunded money stops counting as revenue even when the invoice is
// service-only / has no SKU lines), and relists only this invoice's units (not
// every order that happens to share a SKU). Idempotent: refunding an
// already-refunded invoice no-ops and reports its state.
//
// With `restockingPct` the order is NOT cancelled — it is stripped down to a
// single restocking-fee line, because that fee is revenue we keep and cancelling
// would erase it.
export async function refundInvoice(invoiceId, { restockingPct = 0, reason = '', by = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows: ex } = await query(
    'SELECT id, number, status, subtotal, hst, total, refund_total, order_id FROM invoices WHERE id = $1',
    [invoiceId]
  );
  if (!ex.length) throw new Error('Invoice not found.');
  const pre = ex[0];
  if (pre.status === 'refunded') {
    return { id: pre.id, number: pre.number, status: 'refunded', relisted: 0, orderCancelled: false,
             refundAmount: 0, feeKept: 0, alreadyRefunded: true };
  }
  if (pre.status !== 'paid') throw new Error('Only a paid invoice can be refunded.');

  // What is still refundable = everything charged that hasn't already come back.
  // Derived from the totals rather than the lines, so a mix of earlier per-line
  // refunds and kept fees can never over- or under-refund the remainder.
  const hasHst = Number(pre.hst) > 0;
  const owed = round2(Number(pre.total) - (Number(pre.refund_total) || 0));
  if (owed <= 0.005) throw new Error(`${pre.number} has already had its full value refunded.`);
  const owedBase = hasHst ? round2(owed / (1 + HST_RATE)) : owed;
  const split = splitRestocking(owedBase, restockingPct, hasHst);

  const { rows } = await query(
    `UPDATE invoices SET status = 'refunded', refunded_at = now(),
            refund_total = LEAST(total, round((COALESCE(refund_total,0) + $2)::numeric, 2))
      WHERE id = $1 AND status = 'paid' RETURNING id, number, total, order_id`,
    [invoiceId, split.refundAmount]
  );
  if (!rows.length) throw new Error('Only a paid invoice can be refunded.');
  const inv = rows[0];

  // Take the sale out of the revenue counts, and release any reservations it
  // held. With a fee kept, the order lives on carrying just that fee.
  let orderCancelled = false;
  if (inv.order_id) {
    try {
      if (!split.feeKept) {
        const c = await query("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled' RETURNING id", [inv.order_id]);
        if (c.rowCount) {
          orderCancelled = true;
          await query('DELETE FROM reservations WHERE order_id = $1', [inv.order_id]).catch(() => {});
        }
      } else {
        await withTransaction(async (client) => {
          const { rows: ord } = await client.query('SELECT id FROM orders WHERE id = $1', [inv.order_id]);
          if (!ord.length) return;
          await client.query('DELETE FROM order_items WHERE order_id = $1', [inv.order_id]);
          await addRestockingFeeLine(client, inv.order_id, `Restocking fee (${split.pct}%) — ${inv.number} returned`, split.keptBase);
          await client.query(
            `UPDATE orders SET subtotal = $2, hst = $3, total = $4,
                    notes = COALESCE(notes || E'\\n', '') || $5
              WHERE id = $1`,
            [inv.order_id, split.keptBase, split.keptHst, split.feeKept,
             `Returned ${torontoToday()}: refunded $${split.refundAmount.toFixed(2)}, kept ${split.pct}% restocking fee $${split.feeKept.toFixed(2)}.`]
          );
          await client.query('DELETE FROM reservations WHERE order_id = $1', [inv.order_id]);
        });
      }
    } catch (e) {
      console.error('refund order adjust failed', e.message);
    }
  }

  // Relist this invoice's unit(s) on the storefront — product-level only, scoped
  // to its own SKUs (does NOT touch other orders that share a SKU).
  let relisted = 0;
  try {
    const { rows: its } = await query(
      "SELECT sku FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL AND COALESCE(kind,'unit') <> 'service' AND refunded_at IS NULL",
      [invoiceId]
    );
    const skus = [...new Set(its.map((x) => x.sku).filter(Boolean))];
    if (skus.length) {
      const r = await query(
        `UPDATE products SET active = true, sold_at = null, sold_price = null, sold_channel = null,
                             sold_ref = null, tracker_synced = false, synced_at = now()
          WHERE sku = ANY($1)`,
        [skus]
      );
      relisted = r.rowCount || 0;
      // ...and put them back to 'Tested Working' on the master tracker, or the
      // next sync reads them as Sold and pulls them straight back off the site.
      await reverseTrackerSale(skus);
    }
  } catch (e) {
    console.error('refundInvoice relist failed', e.message);
  }
  // Stamp every line refunded so the hosted invoice shows them consistently with
  // partial refunds (best-effort — the invoice status is the source of truth).
  await query('UPDATE invoice_items SET refunded_at = now() WHERE invoice_id = $1 AND refunded_at IS NULL', [invoiceId]).catch(() => {});
  await logRefund(invoiceId, { amount: split.refundAmount, fee: split.feeKept, pct: split.pct, kind: 'full', reason, by });
  return {
    id: inv.id, number: inv.number, status: 'refunded', relisted, orderCancelled,
    refundAmount: split.refundAmount, feeKept: split.feeKept, restockingPct: split.pct
  };
}

// Refund SELECTED lines of a paid invoice (per-unit refund) — e.g. one appliance
// out of a three-unit order comes back. For each refunded line: the unit is
// relisted on the storefront, and the line's amount (plus its HST share, when the
// invoice charged HST) comes OFF the bridged fulfilment order so the dashboard
// stops counting that money. The invoice keeps its original totals for the books;
// refunded lines are stamped (invoice_items.refunded_at) and the running refund
// is tracked in invoices.refund_total. Refunding the last remaining line(s)
// escalates to a full refund (status 'refunded', order cancelled).
// Select lines by itemIds (invoice_items.id) and/or skus.
//
// `restockingPct` keeps that share of the returned lines' value: only the rest
// leaves the order, and the fee goes back on as its own line.
export async function refundInvoiceItems(invoiceId, { itemIds = [], skus = [], restockingPct = 0, reason = '', by = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows: ex } = await query('SELECT id, number, status, subtotal, hst, total, refund_total, order_id FROM invoices WHERE id = $1', [invoiceId]);
  if (!ex.length) throw new Error('Invoice not found.');
  const inv = ex[0];
  if (inv.status !== 'paid') throw new Error(`Only a paid invoice can be refunded (this one is ${inv.status}).`);

  const ids = [...new Set((itemIds || []).map((n) => parseInt(n, 10)).filter(Number.isFinite))];
  const wantSkus = [...new Set((skus || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!ids.length && !wantSkus.length) throw new Error('Pick at least one line to refund.');

  const { rows: all } = await query(
    'SELECT id, description, sku, amount, kind, refunded_at FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [invoiceId]
  );
  const lowerSkus = wantSkus.map((s) => s.toLowerCase());
  const targets = all.filter((it) => !it.refunded_at &&
    (ids.includes(it.id) || (it.sku && lowerSkus.includes(String(it.sku).toLowerCase()))));
  if (!targets.length) {
    throw new Error('None of the selected lines can be refunded — they may already be refunded. Nothing changed.');
  }

  // Every remaining line selected → this is a full refund; reuse that path so the
  // order is cancelled outright (or stripped to the fee) and the invoice flips.
  const remaining = all.filter((it) => !it.refunded_at);
  if (targets.length === remaining.length) {
    const full = await refundInvoice(invoiceId, { restockingPct, reason, by });
    return { ...full, refundedItems: targets.length, fullyRefunded: true };
  }

  const hasHst = Number(inv.hst) > 0;
  const base = round2(targets.reduce((a, it) => a + (Number(it.amount) || 0), 0));
  const split = splitRestocking(base, restockingPct, hasHst);
  const targetIds = targets.map((it) => it.id);

  await withTransaction(async (client) => {
    await client.query('UPDATE invoice_items SET refunded_at = now() WHERE id = ANY($1)', [targetIds]);
    await client.query(
      'UPDATE invoices SET refund_total = LEAST(total, round((COALESCE(refund_total,0) + $2)::numeric, 2)) WHERE id = $1',
      [invoiceId, split.refundAmount]
    );

    // Take the refunded lines off the bridged order so revenue/profit shrink by
    // exactly this refund. Match each order line by SKU when the invoice line has
    // one, otherwise by title+price (order lines were created verbatim from the
    // invoice lines) — one order row per refunded line.
    if (inv.order_id) {
      const { rows: ord } = await client.query('SELECT id, status FROM orders WHERE id = $1', [inv.order_id]);
      if (ord.length && ord[0].status !== 'cancelled') {
        for (const it of targets) {
          await client.query(
            `DELETE FROM order_items WHERE id = (
               SELECT id FROM order_items
                WHERE order_id = $1
                  AND ((($2::text IS NOT NULL) AND sku = $2) OR (($2::text IS NULL) AND sku IS NULL AND title = $3))
                ORDER BY abs(price - $4) ASC LIMIT 1)`,
            [inv.order_id, it.sku || null, it.description, Number(it.amount) || 0]
          );
        }
        await addRestockingFeeLine(client, inv.order_id,
          `Restocking fee (${split.pct}%) — ${targets.length} line(s) returned`, split.keptBase);
        await client.query(
          `UPDATE orders SET
             subtotal = GREATEST(0, round((subtotal - $2)::numeric, 2)),
             hst      = GREATEST(0, round((hst - $3)::numeric, 2)),
             total    = GREATEST(0, round((total - $4)::numeric, 2)),
             notes    = COALESCE(notes || E'\\n', '') || $5
           WHERE id = $1`,
          [inv.order_id, split.refundBase, split.refundHst, split.refundAmount,
           `Partial refund ${torontoToday()}: ${targets.map((t) => t.description).join(', ')} (−$${split.refundAmount.toFixed(2)}` +
           (split.feeKept ? `, kept ${split.pct}% restocking fee $${split.feeKept.toFixed(2)}` : '') + ')']
        );
      }
    }
  });

  // Relist the refunded unit(s) on the storefront — same product-level relist as a
  // full refund, scoped to the refunded lines' SKUs. Best-effort, outside the txn.
  let relisted = 0;
  try {
    const refundSkus = [...new Set(targets.filter((it) => it.sku && (it.kind || 'unit') !== 'service').map((it) => it.sku))];
    if (refundSkus.length) {
      const r = await query(
        `UPDATE products SET active = true, sold_at = null, sold_price = null, sold_channel = null,
                             sold_ref = null, tracker_synced = false, synced_at = now()
          WHERE sku = ANY($1)`,
        [refundSkus]
      );
      relisted = r.rowCount || 0;
      // Same reversal as the full-refund path — keep the master tracker in step
      // so the next sync doesn't deactivate what we just relisted.
      await reverseTrackerSale(refundSkus);
    }
  } catch (e) {
    console.error('refundInvoiceItems relist failed', e.message);
  }

  await logRefund(invoiceId, { amount: split.refundAmount, fee: split.feeKept, pct: split.pct, kind: 'items', reason, by });
  return {
    id: inv.id, number: inv.number, status: 'paid', fullyRefunded: false,
    refundedItems: targets.length, refundAmount: split.refundAmount, relisted,
    feeKept: split.feeKept, restockingPct: split.pct,
    refundTotal: Math.min(Number(inv.total), round2(Number(inv.refund_total || 0) + split.refundAmount))
  };
}

// Refund an ARBITRARY amount against an invoice that has taken money — a price
// adjustment after the fact, a goodwill credit, a deposit handed back, the
// balance of a return settled in cash. Money only: it moves NO stock, so the
// unit stays sold and off the storefront. (If the appliance itself came back,
// use the per-line refund above — that one relists it.)
//
// The amount typed is what physically leaves the bank, so it is treated as
// tax-INCLUSIVE when the invoice charged HST: the order's subtotal and HST are
// both reduced by their share, keeping the tax line honest. The reduction goes
// on the order as its own negative line, dated into the ORIGINAL sale's month —
// a $200 refund in August against a $1,500 May sale moves May by −$200, with no
// second record anywhere.
export async function refundInvoiceAmount(invoiceId, { amount, reason = '', by = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const amt = round2(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a refund amount greater than zero.');

  const { rows: ex } = await query(
    `SELECT i.id, i.number, i.status, i.hst, i.total, i.refund_total, i.order_id,
            (SELECT COALESCE(SUM(p.amount), 0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS collected
       FROM invoices i WHERE i.id = $1`,
    [invoiceId]
  );
  if (!ex.length) throw new Error('Invoice not found.');
  const inv = ex[0];
  if (!['paid', 'partial'].includes(inv.status)) {
    throw new Error(`${inv.number} is ${inv.status} — money can only be returned on an invoice that has taken some (paid or part-paid).`);
  }

  // Never hand back more than was actually collected. Invoices settled before the
  // payment ledger existed have no payment rows, so a 'paid' one falls back to
  // its total rather than refusing a legitimate refund.
  const collected = round2(Math.max(Number(inv.collected) || 0, inv.status === 'paid' ? Number(inv.total) || 0 : 0));
  const refundable = round2(collected - (Number(inv.refund_total) || 0));
  if (refundable <= 0.005) throw new Error(`Everything collected on ${inv.number} has already been refunded.`);
  if (amt > refundable + 0.005) {
    throw new Error(`That's more than the ${money(refundable)} still refundable on ${inv.number} — refund up to that.`);
  }

  const hasHst = Number(inv.hst) > 0;
  const refundBase = hasHst ? round2(amt / (1 + HST_RATE)) : amt;
  const refundHst = round2(amt - refundBase);
  const note = String(reason || '').trim().slice(0, 300);
  // Returning every cent collected on a settled invoice closes it out, exactly as
  // the Refund button does. A part-paid invoice stays open — the sale is still on.
  const closesOut = inv.status === 'paid' && amt >= refundable - 0.005;

  let orderAdjusted = false;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE invoices SET
         refund_total = LEAST(total, round((COALESCE(refund_total,0) + $2)::numeric, 2)),
         status       = CASE WHEN $3 THEN 'refunded' ELSE status END,
         refunded_at  = CASE WHEN $3 THEN now() ELSE refunded_at END
       WHERE id = $1`,
      [invoiceId, amt, closesOut]
    );
    if (inv.order_id) {
      const { rows: ord } = await client.query('SELECT id, status FROM orders WHERE id = $1', [inv.order_id]);
      if (ord.length && ord[0].status !== 'cancelled') {
        await client.query(
          'INSERT INTO order_items (order_id, sku, title, price) VALUES ($1, null, $2, $3)',
          [inv.order_id, `Refund ${torontoToday()}${note ? ` — ${note}` : ''}`.slice(0, 200), -refundBase]
        );
        await client.query(
          `UPDATE orders SET
             subtotal = round((subtotal - $2)::numeric, 2),
             hst      = round((hst - $3)::numeric, 2),
             total    = round((total - $4)::numeric, 2),
             notes    = COALESCE(notes || E'\\n', '') || $5
           WHERE id = $1`,
          [inv.order_id, refundBase, refundHst, amt,
           `Refund ${torontoToday()}: −$${amt.toFixed(2)}${note ? ` (${note})` : ''}`]
        );
        orderAdjusted = true;
      }
    }
  });

  await logRefund(invoiceId, { amount: amt, fee: 0, pct: 0, kind: 'amount', reason: note, by });
  return {
    id: inv.id, number: inv.number,
    status: closesOut ? 'refunded' : inv.status,
    refundAmount: amt, orderAdjusted, movedStock: false,
    refundTotal: round2((Number(inv.refund_total) || 0) + amt),
    stillRefundable: round2(refundable - amt)
  };
}

// Permanently delete an invoice created in error. Only allowed for invoices that
// never took money (open / void) — paid invoices must be refunded, never deleted,
// so the books stay intact. Cascades to invoice_items (ON DELETE CASCADE).
export async function deleteInvoice(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows: ex } = await query('SELECT id, number, status, order_id FROM invoices WHERE id = $1', [invoiceId]);
  if (!ex.length) throw new Error('Invoice not found.');
  const inv = ex[0];
  if (inv.status === 'paid' || inv.status === 'refunded') {
    throw new Error('This invoice has been paid — refund it instead of deleting (keeps your records clean).');
  }
  // A 'partial' invoice has real money against it. Deleting would destroy the
  // payment record along with the invoice, and deposits are the normal case now.
  const { rows: pay } = await query(
    'SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments WHERE invoice_id = $1', [invoiceId]
  ).catch(() => ({ rows: [{ paid: 0 }] }));
  const paidSoFar = round2(Number(pay[0]?.paid) || 0);
  if (paidSoFar > 0) {
    throw new Error(`${inv.number} has ${money(paidSoFar)} paid against it — remove that payment first if it was an error, or refund it. Deleting would lose the record.`);
  }
  // An open/void invoice still owns the order raised when it was written — cancel
  // it and drop its hold so the money leaves the dashboard and the units relist.
  const { cancelled } = await cancelInvoiceOrder(inv.order_id);
  await query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
  return { id: inv.id, number: inv.number, deleted: true, orderCancelled: cancelled };
}

// Edit an invoice — its lines, prices, HST, memo, issue date, and the customer's
// own details. Works on a live invoice (open / partly paid) AND on a settled one,
// because a sale three months old is exactly the kind you need to correct.
// void / refunded invoices stay locked: they're closed records.
//
// HOW A CORRECTION TO A SETTLED SALE BEHAVES
// A unit invoiced at $1,500 in May, knocked down to $1,300 in August, adjusts
// MAY by −$200. That falls out of the design rather than needing an adjustment
// entry: the invoice's fulfilment order keeps its original created_at and only
// its total moves, and the dashboard buckets revenue by that date. There is no
// second record anywhere, so there is nothing to double-count.
//
// Stock only moves when the LINES move:
//   * a line kept (even at a different price) leaves its unit exactly as it is —
//     still sold, still off the storefront. Correcting a price is not a return.
//     The new price is pushed to the product and to the master tracker so the
//     books, the site and the sheet agree.
//   * a line REMOVED from a settled invoice relists its unit and reverses the
//     tracker sale — that unit really did come back.
//   * a line ADDED to a settled invoice sells its unit.
//   * on a live invoice the same diff moves the reservation hold instead.
//
// Status is then re-derived from the payment ledger: raise the total above what
// has been paid and the invoice goes back to owing; drop it below and the excess
// is reported as `overpaid` for the owner to hand back. A refund isn't invented
// here — money hasn't physically moved until somebody moves it.
export async function updateInvoice(invoiceId, {
  items, addHst, memo, invoiceDate,
  name, email, phone, deliveryMethod, address, city, postal
}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const backdate = normalizeBackdate(invoiceDate, 'invoice date');
  const { rows: ex } = await query(
    `SELECT i.id, i.number, i.status, i.order_id, i.email, i.hst AS old_hst,
            (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS paid_so_far
       FROM invoices i WHERE i.id = $1`, [invoiceId]
  );
  if (!ex.length) throw new Error('Invoice not found.');
  const inv = ex[0];
  if (!['open', 'partial', 'paid'].includes(inv.status)) {
    throw new Error(`A ${inv.status} invoice is a closed record and can't be edited. Reissue a new one instead.`);
  }
  const orderId = inv.order_id || null;
  const wasSettled = inv.status === 'paid';
  const paidSoFar = round2(Number(inv.paid_so_far) || 0);

  const WARRANTY = new Set([3, 6, 12, 24]);
  const lineItems = (items || [])
    .map((it) => {
      const service = it.kind === 'service';
      const wm = Number(it.warrantyMonths);
      const cost = Number(it.cost);
      return {
        description: String(it.description || '').trim().slice(0, 500),
        amount: round2(Number(it.amount)),
        sku: service ? null : (String(it.sku || '').trim() || null),
        kind: service ? 'service' : 'unit',
        warrantyMonths: service ? null : (WARRANTY.has(wm) ? wm : null),
        cost: service ? null : (Number.isFinite(cost) && cost >= 0 ? round2(cost) : null)
      };
    })
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const hst = addHst ? round2(subtotal * HST_RATE) : 0;
  const total = round2(subtotal + hst);

  // What the invoice held before the edit, so the diff below knows which units
  // genuinely left the sale and which merely changed price.
  const { rows: before } = await query(
    "SELECT sku, amount FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL AND COALESCE(kind,'unit') <> 'service'",
    [invoiceId]
  );
  const skusBefore = new Map(before.map((r) => [r.sku, round2(Number(r.amount) || 0)]));
  const skusAfter = new Map(
    lineItems.filter((li) => li.kind !== 'service' && li.sku).map((li) => [li.sku, li.amount])
  );
  const removed = [...skusBefore.keys()].filter((sku) => !skusAfter.has(sku));
  const added = [...skusAfter.keys()].filter((sku) => !skusBefore.has(sku));
  const repriced = [...skusAfter.entries()]
    .filter(([sku, amt]) => skusBefore.has(sku) && skusBefore.get(sku) !== amt);

  // Contact / fulfilment details. Only fields actually supplied are touched, so a
  // caller that just edits line items can't blank someone's address.
  const set = (v) => (v === undefined ? undefined : (String(v).trim() || null));
  const contact = {
    name: set(name),
    // Blanking the email would orphan the invoice — an empty string is treated
    // as "not supplied" rather than as a deletion.
    email: email === undefined ? undefined : (String(email).trim().toLowerCase() || undefined),
    phone: set(phone), address: set(address), city: set(city), postal: set(postal),
    delivery_method: deliveryMethod === undefined ? undefined : (deliveryMethod === 'delivery' ? 'delivery' : 'pickup')
  };
  const contactCols = Object.entries(contact).filter(([, v]) => v !== undefined);

  // Where the invoice lands once the numbers move: still owing → open/partial,
  // covered → paid. `overpaid` is money received above the corrected total.
  const nextStatus = total > paidSoFar + 0.005
    ? (paidSoFar > 0 ? 'partial' : 'open')
    : 'paid';
  const overpaid = round2(Math.max(0, paidSoFar - total));

  await withTransaction(async (client) => {
    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, warranty_months, cost) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [invoiceId, li.description, li.sku, li.amount, li.kind, li.warrantyMonths, li.cost]
      );
    }
    await client.query(
      'UPDATE invoices SET subtotal = $2, hst = $3, total = $4, memo = $5, status = $6 WHERE id = $1',
      [invoiceId, subtotal, hst, total, memo != null ? String(memo).trim() : null, nextStatus]
    );
    // An invoice that's no longer settled shouldn't keep a paid stamp on it.
    if (nextStatus !== 'paid') {
      await client.query('UPDATE invoices SET paid_at = NULL, payment_method = NULL WHERE id = $1', [invoiceId]);
    }
    if (contactCols.length) {
      const sets = contactCols.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      await client.query(`UPDATE invoices SET ${sets} WHERE id = $1`, [invoiceId, ...contactCols.map(([, v]) => v)]);
    }
    // Re-date the invoice (backdate a sale rung up late). A supplied date of
    // "today" also re-dates — that's how a backdate gets undone.
    if (backdate) {
      await client.query(`UPDATE invoices SET created_at = ${NOON_TORONTO('$2')} WHERE id = $1`, [invoiceId, backdate]);
    } else if (String(invoiceDate || '').trim()) {
      await client.query('UPDATE invoices SET created_at = now() WHERE id = $1', [invoiceId]);
    }

    // Mirror everything onto the fulfilment order. Its created_at is only touched
    // when the issue date itself changed — that's what keeps a correction landing
    // in the month of the ORIGINAL sale instead of the month you made it.
    if (orderId) {
      await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      for (const li of lineItems) {
        await client.query(
          'INSERT INTO order_items (order_id, sku, title, price, cost) VALUES ($1,$2,$3,$4,$5)',
          [orderId, li.sku || null, li.description, li.amount, li.cost]
        );
      }
      await client.query(
        'UPDATE orders SET subtotal = $2, hst = $3, total = $4 WHERE id = $1',
        [orderId, subtotal, hst, total]
      );
      const orderContact = contactCols.filter(([k]) => k !== 'email' || contact.email);
      if (orderContact.length) {
        const sets = orderContact.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        await client.query(`UPDATE orders SET ${sets} WHERE id = $1`, [orderId, ...orderContact.map(([, v]) => v)]);
      }
      // A settled sale that goes back to owing shouldn't stay 'confirmed'; one
      // that becomes settled shouldn't stay 'pending_payment'.
      if (nextStatus === 'paid') {
        await client.query("UPDATE orders SET status = 'confirmed' WHERE id = $1 AND status = 'pending_payment'", [orderId]);
      } else {
        await client.query("UPDATE orders SET status = 'pending_payment' WHERE id = $1 AND status = 'confirmed'", [orderId]);
      }
      if (backdate) {
        await client.query(`UPDATE orders SET created_at = ${NOON_TORONTO('$2')} WHERE id = $1`, [orderId, backdate]);
      } else if (String(invoiceDate || '').trim()) {
        await client.query('UPDATE orders SET created_at = now() WHERE id = $1', [orderId]);
      }
    }
  });

  // A live invoice with no fulfilment order at all — settled before the order
  // bridge existed, or its creation failed — has nothing for this edit to
  // adjust, so the corrected figures would never reach the dashboard. Complete
  // the record first, dated to the invoice, then carry on.
  let effOrderId = orderId;
  if (!effOrderId) {
    try {
      await backfillInvoiceOrder(invoiceId, { holdSkus: false });
      const { rows: linked } = await query('SELECT order_id FROM invoices WHERE id = $1', [invoiceId]);
      effOrderId = linked[0]?.order_id || null;
    } catch (e) {
      console.error('updateInvoice could not create the missing order', e.message);
    }
  }

  // ── Stock, outside the transaction and best-effort ────────────────────────
  // A line that only changed PRICE never moves stock: the unit stays exactly as
  // it was. Units move when they join or leave the sale, or when the invoice
  // crosses the settled line in either direction.
  const liveSkus = [...skusAfter.keys()];
  const relist = async (skus) => {
    if (!skus.length) return;
    await query(
      `UPDATE products SET active = true, sold_at = null, sold_price = null, sold_channel = null,
                           sold_ref = null, tracker_synced = false, synced_at = now()
        WHERE sku = ANY($1)`, [skus]
    );
    await reverseTrackerSale(skus);
  };

  let contested = [];
  let relisted = [];
  try {
    if (nextStatus === 'paid') {
      // Settled after the edit. Anything dropped from the invoice really did come
      // back, so relist it; anything the invoice now holds is sold.
      if (removed.length) { await relist(removed); relisted = removed; }
      // If it wasn't settled before, every remaining unit sells now. If it was,
      // only the newly-added ones do — plus a price push for lines whose amount
      // changed, so the product record and the master tracker match the invoice.
      const toSell = wasSettled ? added : liveSkus;
      const priceOf = (skus) => Object.fromEntries(skus.map((sku) => [sku, skusAfter.get(sku)]));
      if (toSell.length) await markUnitsSold(toSell, { channel: 'invoice', ref: inv.number, prices: priceOf(toSell) });
      if (wasSettled && repriced.length) {
        const skus = repriced.map(([sku]) => sku);
        await markUnitsSold(skus, { channel: 'invoice', ref: inv.number, prices: priceOf(skus) });
      }
      // A sold unit is blocked by its order's status, so the reservation is spare.
      if (effOrderId) await query('DELETE FROM reservations WHERE order_id = $1', [effOrderId]).catch(() => {});
    } else {
      // Live after the edit (money still owing). A previously-settled invoice has
      // sold units to undo — but the ones it STILL carries must stay off the
      // storefront, held rather than sold, or the edit would quietly put a unit
      // the customer is still buying back up for sale.
      if (wasSettled) await relist([...new Set([...liveSkus, ...removed])]);
      if (removed.length) {
        if (effOrderId && !wasSettled) {
          await query('DELETE FROM reservations WHERE order_id = $1 AND sku = ANY($2)', [effOrderId, removed]).catch(() => {});
        }
        relisted = removed;
      }
      if (effOrderId) {
        // Coming back from settled there are no holds left (marking paid dropped
        // them), so re-claim everything. Otherwise the kept lines already hold
        // their units and only the new ones need claiming.
        const need = wasSettled ? liveSkus : added;
        if (need.length) contested = await holdInvoiceSkus(effOrderId, need);
      }
    }
  } catch (e) {
    console.error('updateInvoice stock sync failed', e.message);
  }

  return {
    id: invoiceId, number: inv.number, subtotal, hst, total,
    status: nextStatus, amountPaid: paidSoFar,
    balance: round2(Math.max(0, total - paidSoFar)),
    overpaid, contested, relisted,
    wasSettled
  };
}

// Re-send the invoice email to the customer — after an edit changed the amounts,
// or when the original went missing. Open/partial invoices only: the email is a
// payment request (e-transfer instructions), so re-sending a paid/void/refunded
// one would ask for money that isn't owed. A partially-paid invoice re-sends
// with its payments to date and asks only for the BALANCE. Unlike create (where
// the record matters more than the mail), a resend IS the email — so a mail
// failure throws and the UI reports it instead of pretending it went out.
export async function resendInvoice(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT i.*,
            (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id = i.id) AS amount_paid
       FROM invoices i WHERE i.id = $1`, [invoiceId]
  );
  if (!rows.length) throw new Error('Invoice not found.');
  const inv = rows[0];
  if (inv.status !== 'open' && inv.status !== 'partial') {
    throw new Error(`Only an open or partially-paid invoice can be re-sent (this one is ${inv.status}) — its email asks the customer to pay.`);
  }
  const { rows: items } = await query(
    'SELECT description, amount, kind, warranty_months FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [invoiceId]
  );
  const amountPaid = round2(Number(inv.amount_paid) || 0);
  await sendInvoiceEmail({
    brand: inv.brand,
    number: inv.number, name: inv.name, email: inv.email,
    subtotal: inv.subtotal, hst: inv.hst, total: inv.total, memo: inv.memo,
    dueDate: inv.due_date, deliveryMethod: inv.delivery_method,
    phone: inv.phone, address: inv.address, city: inv.city, postal: inv.postal,
    items,
    amountPaid,
    balance: round2(Math.max(0, (Number(inv.total) || 0) - amountPaid))
  });
  return { id: inv.id, number: inv.number, email: inv.email, emailed: true };
}

// Give an invoice the fulfilment order it's missing. Two cases reach here: an
// invoice paid before the bridge existed (invisible to the orders-based
// dashboard), and a live invoice whose up-front order creation failed. Either
// way the order is dated to when the invoice was WRITTEN, because that's the day
// the sale counts. Idempotent via invoices.order_id.
export async function backfillInvoiceOrder(invoiceId, { holdSkus = true } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT id, number, name, email, phone, delivery_method, address, city, postal,
            subtotal, hst, total, payment_method, paid_at, created_at, order_id, status
       FROM invoices WHERE id = $1`,
    [invoiceId]
  );
  if (!rows.length) throw new Error('Invoice not found.');
  const iv = rows[0];
  if (!['open', 'partial', 'paid'].includes(iv.status)) {
    throw new Error(`A ${iv.status} invoice isn't a live sale — nothing to add to the dashboard.`);
  }
  if (iv.order_id) {
    const { rows: o } = await query('SELECT order_number FROM orders WHERE id = $1', [iv.order_id]);
    return { number: iv.number, orderNumber: o[0]?.order_number || null, alreadyLinked: true };
  }
  const { rows: lines } = await query('SELECT description, sku, amount, cost, refunded_at FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [invoiceId]);
  // Skip lines already refunded (a partial refund can land before this backfill
  // runs — e.g. the original bridge errored and the nightly sweep is catching up).
  // With refunds in play the order totals are re-derived from the kept lines so
  // the dashboard never counts returned money.
  const kept = lines.filter((l) => !l.refunded_at);
  if (!kept.length) throw new Error('Every line on this invoice has been refunded — nothing to add to the dashboard.');
  const anyRefunded = kept.length !== lines.length;
  const subtotal = anyRefunded ? round2(kept.reduce((a, l) => a + (Number(l.amount) || 0), 0)) : iv.subtotal;
  const hst = anyRefunded ? (Number(iv.hst) > 0 ? round2(subtotal * HST_RATE) : 0) : iv.hst;
  const total = anyRefunded ? round2(Number(subtotal) + Number(hst)) : iv.total;
  const paid = iv.status === 'paid';
  const order = await createOrderFromInvoice(
    { invoiceNumber: iv.number, email: iv.email, name: iv.name, phone: iv.phone,
      deliveryMethod: iv.delivery_method, address: iv.address, city: iv.city, postal: iv.postal,
      subtotal, hst, total, paymentMethod: iv.payment_method,
      items: kept.map((l) => ({ sku: l.sku || null, title: l.description, price: l.amount, cost: l.cost })) },
    {
      // Settled invoices land confirmed; a live one lands pending_payment and
      // holds its units, exactly as if it had been raised through the normal path.
      status: paid ? 'confirmed' : 'pending_payment',
      // Date the sale to when the invoice was WRITTEN. Revenue is booked on that
      // day now, so a deposit sale counts when it happened rather than whenever
      // the balance eventually clears.
      createdAt: iv.created_at,
      holdSkus: !paid && holdSkus
    }
  );
  await query('UPDATE invoices SET order_id = $2 WHERE id = $1', [invoiceId, order.id]);
  return { number: iv.number, orderNumber: order.orderNumber, alreadyLinked: false, contested: order.contested || [] };
}

// How far back the routine sweep will reach for a LIVE (unpaid) invoice.
const LIVE_BACKFILL_DAYS = 14;

// Repair sweep: give a fulfilment order to any invoice that's missing one.
//
// Paid invoices, any age — that's the original job, and it's what the nightly
// cron has always done.
//
// Live (open / partly-paid) invoices are included too, because an invoice now
// raises its order the moment it's written: one without an order means that step
// failed, so the sale is missing from the dashboard and its units are still on
// sale. But only ones raised in the last LIVE_BACKFILL_DAYS days by default.
// Reaching further back on a schedule would silently move months of historical
// revenue and delist stock against invoices nobody expects to be paid — so the
// full sweep is opt-in (`all: true`, what the Sync button sends) and reports
// what it touched. Even then, only recent live invoices claim their units: what
// is actually still in stock behind a months-old unpaid invoice is anyone's
// guess, and wrongly hiding a unit costs a sale.
export async function backfillAllInvoiceOrders({ all = false } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT id, number, status,
            (created_at >= now() - ($1 || ' days')::interval) AS recent
       FROM invoices
      WHERE order_id IS NULL
        AND (status = 'paid'
             OR (status IN ('open','partial')
                 AND ($2 OR created_at >= now() - ($1 || ' days')::interval)))
      ORDER BY id`,
    [String(LIVE_BACKFILL_DAYS), all]
  );
  const created = [];
  const failed = [];
  let held = 0;
  for (const r of rows) {
    try {
      const res = await backfillInvoiceOrder(r.id, { holdSkus: r.status === 'paid' ? false : !!r.recent });
      if (!res.alreadyLinked && res.orderNumber) {
        created.push({ invoice: res.number, order: res.orderNumber, status: r.status });
        if (r.status !== 'paid' && r.recent) held++;
      }
    } catch (e) {
      console.error('backfill invoice order failed', r.id, e.message);
      failed.push({ invoice: r.number, error: e.message });
    }
  }
  return { fixed: created.length, created, failed, unitsHeldFor: held, sweptEverything: !!all };
}

// Packing-slip view of an invoice: each unit line joined to its serial (uid) and
// condition from the catalog so the warehouse/delivery team can pick the exact
// physical unit. Services (delivery/install) are kept as plain lines. No prices.
export async function getPackingSlip(number) {
  if (!hasDb()) return null;
  await ensureInvoiceSchema();
  const { rows } = await query('SELECT * FROM invoices WHERE number = $1', [number]);
  if (!rows.length) return null;
  const inv = rows[0];
  const { rows: items } = await query(
    `SELECT ii.id, ii.description, ii.sku, ii.kind, ii.warranty_months,
            p.uid AS serial, p.condition, p.make, p.model
       FROM invoice_items ii
       LEFT JOIN products p ON p.sku = ii.sku
      WHERE ii.invoice_id = $1
        AND ii.refunded_at IS NULL  -- refunded lines aren't being shipped
      ORDER BY ii.id`,
    [inv.id]
  );
  return { ...inv, items };
}

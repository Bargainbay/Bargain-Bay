// Package quotes — DB-backed, non-binding, and inventory-safe. The owner builds
// a quote in /admin/quotes (or a customer assembles a bundle on /bundle and
// requests one); the client gets a hosted page + email with the itemized
// breakdown. A quote holds NO stock — the units stay live and sellable for
// everyone — until the owner converts it into an invoice, the only point
// inventory actually gets reserved/sold. Mirrors lib/invoices.js.
import { hasDb, query, withTransaction } from './db';
import { round2, HST_RATE, money } from './constants';
import { createAndSendInvoice } from './invoices';
import { sendQuoteEmail, sendBundleRequestAck, notifyOwner, esc } from './email';
import { sendMessage as tgSend } from './telegram';
import { getMany } from './inventory';
import { decorate } from './pricing';
import { linkToken } from './links';
import { upsertCustomer } from './customers';

function hostedPath(number) {
  return number ? `/quote/${encodeURIComponent(number)}` : null;
}
const clampPct = (v) => Math.min(Math.max(Number(v) || 0, 0), 90);

// Self-provision the quote tables on first use, so the feature works the moment
// it deploys without waiting on a manual "run schema migration". All DDL is
// IF NOT EXISTS, so this is idempotent and mirrors db/schema.sql (the canonical
// source). Cached per process — runs at most once.
let _ensured = null;
function ensureSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_ensured) {
    _ensured = query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id serial PRIMARY KEY, number text UNIQUE, email text NOT NULL, name text,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','converted','expired','void')),
        source text, retail_subtotal numeric(10,2), subtotal numeric(10,2),
        bundle_pct numeric(5,2) DEFAULT 0, bundle_price numeric(10,2), hst numeric(10,2),
        total numeric(10,2), cash_deal numeric(10,2), free_delivery boolean DEFAULT false,
        memo text, expires_at date, converted_invoice_id int REFERENCES invoices(id) ON DELETE SET NULL,
        created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS quote_items (
        id serial PRIMARY KEY, quote_id int REFERENCES quotes(id) ON DELETE CASCADE,
        description text, sku text, retail numeric(10,2), amount numeric(10,2));
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
    `).catch((e) => { _ensured = null; throw e; });
  }
  return _ensured;
}

// The single source of truth for the bundle math (authoritative — never trust
// client-sent totals).
function computeTotals(lineItems, { bundlePct, addHst, cashDeal }) {
  const retailSubtotal = round2(lineItems.reduce((a, li) => a + (li.retail || 0), 0));
  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const pct = clampPct(bundlePct);
  const bundlePrice = round2(subtotal * (1 - pct / 100));
  const hst = addHst ? round2(bundlePrice * HST_RATE) : 0;
  const bundleTotal = round2(bundlePrice + hst);
  const cash = cashDeal != null && Number(cashDeal) > 0 ? round2(Number(cashDeal)) : null;
  const total = cash != null ? cash : bundleTotal;
  return { retailSubtotal, subtotal, pct, bundlePrice, hst, bundleTotal, cash, total };
}

const cleanItems = (items) => (items || [])
  .map((it) => ({
    description: String(it.description || '').trim().slice(0, 500),
    amount: round2(Number(it.amount)),
    retail: round2(Number(it.retail) || 0),
    sku: String(it.sku || '').trim() || null
  }))
  .filter((li) => li.description && li.amount > 0);

// Shared insert (used by owner-built quotes and customer requests).
async function saveQuote({ name, email, lineItems, totals, freeDelivery, memo, daysValid, source }) {
  const days = Math.min(Math.max(parseInt(daysValid, 10) || 14, 1), 120);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO quotes (email, name, status, source, retail_subtotal, subtotal, bundle_pct, bundle_price, hst, total, cash_deal, free_delivery, memo, expires_at)
       VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(now() + ($13 || ' days')::interval)::date)
       RETURNING id`,
      [email, name || null, source || 'admin', totals.retailSubtotal, totals.subtotal, totals.pct, totals.bundlePrice, totals.hst, totals.total, totals.cash, !!freeDelivery, memo || null, String(days)]
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE quotes SET number = 'Q-' || (1000 + id) WHERE id = $1 RETURNING number, expires_at`, [id]
    );
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO quote_items (quote_id, description, sku, retail, amount) VALUES ($1,$2,$3,$4,$5)',
        [id, li.description, li.sku, li.retail, li.amount]
      );
    }
    return { id, number: num[0].number, expiresAt: num[0].expires_at, name, email, freeDelivery: !!freeDelivery, memo, items: lineItems, source: source || 'admin', ...totals };
  });
}

// items: [{ description, amount, retail?, sku? }] amount = our price (DOLLARS).
// Owner-built quote: priced, emailed to the customer. If sourceQuoteId is given
// (the customer request it was built from), that request is voided on send.
export async function createAndSendQuote({ name, email, items, bundlePct = 0, cashDeal = null, freeDelivery = false, addHst = true, daysValid = 14, memo, sourceQuoteId = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureSchema();
  const lineItems = cleanItems(items);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive price.');
  const totals = computeTotals(lineItems, { bundlePct, addHst, cashDeal });
  const quote = await saveQuote({ name, email, lineItems, totals, freeDelivery, memo, daysValid, source: 'admin' });

  sendQuoteEmail(quote).catch((e) => console.error('quote email failed', e.message));
  if (sourceQuoteId) voidQuote(sourceQuoteId).catch((e) => console.error('void source request failed', e.message));
  upsertCustomer({ email, name }).catch((e) => console.error('customer upsert failed', e.message));

  // Tokenized link so the owner can paste it straight into Messenger/text and
  // the customer gets one-click access without entering their email.
  return { id: quote.id, number: quote.number, total: totals.total, status: 'open', email, hostedUrl: `${hostedPath(quote.number)}?t=${linkToken('quote', quote.number)}` };
}

// Customer-assembled bundle from /bundle. Prices are looked up server-side from
// live inventory (never trust the client), no discount applied, NOT emailed to
// the customer — it lands in /admin/quotes for the owner to price and send.
export async function createQuoteRequest({ name, email, phone, skus, note }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureSchema();
  const ids = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 30);
  if (!ids.length) throw new Error('Add at least one appliance to your bundle.');
  const units = await decorate(await getMany(ids), null);
  const lineItems = units.map((u) => ({
    description: `${u.title || `${u.make} ${u.model}`} (${u.id})`,
    amount: round2(Number(u.price) || 0),
    retail: round2(Number(u.compareAt) || 0),
    sku: u.id
  })).filter((li) => li.amount > 0);
  if (!lineItems.length) throw new Error('Those items are no longer available — please refresh and try again.');

  const totals = computeTotals(lineItems, { bundlePct: 0, addHst: true, cashDeal: null });
  const memoParts = [];
  if (note) memoParts.push(String(note).trim().slice(0, 500));
  if (phone) memoParts.push(`Phone: ${String(phone).trim().slice(0, 40)}`);
  const quote = await saveQuote({ name, email, lineItems, totals, freeDelivery: false, memo: memoParts.join(' · '), daysValid: 14, source: 'customer' });
  // Instant "we got it" to the customer (the priced quote follows from the owner).
  sendBundleRequestAck(quote).catch((e) => console.error('bundle ack email failed', e.message));
  upsertCustomer({ email, name, phone }).catch((e) => console.error('customer upsert failed', e.message));
  return { id: quote.id, number: quote.number, total: totals.total, name, email, items: lineItems };
}

export async function listQuotes(limit = 25) {
  if (!hasDb()) return [];
  await ensureSchema();
  const { rows } = await query(
    `SELECT id, number, email, name, status, source, total, free_delivery, expires_at, converted_invoice_id, created_at
       FROM quotes ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number || '(draft)',
    email: r.email,
    name: r.name,
    total: Number(r.total) || 0,
    status: r.status,
    source: r.source || 'admin',
    freeDelivery: r.free_delivery,
    hostedUrl: hostedPath(r.number),
    expires: r.expires_at ? r.expires_at.toISOString().slice(0, 10) : null,
    convertedInvoiceId: r.converted_invoice_id,
    created: r.created_at ? r.created_at.toISOString() : null
  }));
}

export async function getQuoteByNumber(number) {
  if (!hasDb()) return null;
  await ensureSchema();
  const { rows } = await query('SELECT * FROM quotes WHERE number = $1', [number]);
  if (!rows.length) return null;
  const q = rows[0];
  const { rows: items } = await query('SELECT id, description, sku, retail, amount FROM quote_items WHERE quote_id = $1 ORDER BY id', [q.id]);
  return { ...q, items };
}

// Load a quote by id with items, shaped for prefilling the admin builder.
export async function getQuoteForBuilder(id) {
  if (!hasDb() || !id) return null;
  await ensureSchema();
  const { rows } = await query('SELECT id, name, email FROM quotes WHERE id = $1', [Number(id)]);
  if (!rows.length) return null;
  const { rows: items } = await query('SELECT description, sku, retail, amount FROM quote_items WHERE quote_id = $1 ORDER BY id', [Number(id)]);
  return {
    sourceQuoteId: rows[0].id,
    name: rows[0].name || '',
    email: rows[0].email || '',
    items: items.map((it) => ({ description: it.description, sku: it.sku || '', retail: it.retail != null ? String(Number(it.retail)) : '', amount: it.amount != null ? String(Number(it.amount)) : '' }))
  };
}

// Turn an open/accepted quote into an invoice — the moment stock is committed.
// The bundle discount is distributed across the line items so the invoice's own
// subtotal lands on the bundle price (HST + total then match the quote). The
// SKUs ride along so marking the invoice paid delists those units. Idempotent.
// createdBy: { email, name } of the staff member converting it — the resulting
// invoice is credited to them, same as one raised directly.
export async function convertQuoteToInvoice(quoteId, createdBy) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureSchema();
  const { rows } = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (!rows.length) throw new Error('Quote not found.');
  const q = rows[0];
  if (q.status === 'converted' && q.converted_invoice_id) {
    const { rows: inv } = await query('SELECT number FROM invoices WHERE id = $1', [q.converted_invoice_id]);
    return { alreadyConverted: true, invoiceId: q.converted_invoice_id, invoiceNumber: inv[0]?.number, invoiceUrl: inv[0]?.number ? `/invoice/${encodeURIComponent(inv[0].number)}` : null };
  }
  if (!['open', 'accepted', 'expired'].includes(q.status)) throw new Error(`A ${q.status} quote can't be converted.`);
  const { rows: items } = await query('SELECT description, sku, amount FROM quote_items WHERE quote_id = $1 ORDER BY id', [quoteId]);
  if (!items.length) throw new Error('Quote has no line items.');

  const subtotal = Number(q.subtotal) || items.reduce((a, it) => a + Number(it.amount), 0);
  const addHst = Number(q.hst) > 0;
  const cash = Number(q.cash_deal) > 0 ? Number(q.cash_deal) : null;
  // Target the PRE-TAX subtotal so the final invoice total matches the figure the
  // customer agreed to. For an all-in cash deal that's the cash number (back out
  // HST when it applies, so the invoice still breaks out HST and totals to cash);
  // otherwise it's the bundle price.
  const targetSubtotal = cash != null
    ? (addHst ? round2(cash / (1 + HST_RATE)) : cash)
    : (Number(q.bundle_price) || subtotal);
  const ratio = subtotal > 0 ? targetSubtotal / subtotal : 1;
  let running = 0;
  const scaled = items.map((it) => {
    const amt = round2(Number(it.amount) * ratio);
    running = round2(running + amt);
    return { description: it.description, sku: it.sku || null, amount: amt };
  });
  const drift = round2(targetSubtotal - running);
  if (drift !== 0 && scaled.length) scaled[scaled.length - 1].amount = round2(scaled[scaled.length - 1].amount + drift);

  const memoParts = [];
  if (q.number) memoParts.push(`Converted from quote ${q.number}.`);
  if (cash != null) memoParts.push(`All-in cash deal: ${money(cash)}.`);
  else if (Number(q.bundle_pct) > 0) memoParts.push(`${Number(q.bundle_pct)}% bundle discount applied.`);
  if (q.free_delivery) memoParts.push('Free delivery included.');
  if (q.memo) memoParts.push(q.memo);

  const invoice = await createAndSendInvoice({
    name: q.name, email: q.email, items: scaled, addHst, daysUntilDue: 14, memo: memoParts.join(' '),
    createdBy
  });

  await query("UPDATE quotes SET status = 'converted', converted_invoice_id = $2 WHERE id = $1", [quoteId, invoice.id]);
  return { invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceUrl: invoice.hostedUrl, total: invoice.total };
}

// Edit an OPEN quote in place — same Q- number, new lines/pricing/terms. An
// accepted quote is locked (the customer said yes to specific numbers — convert
// it, or void and reissue); converted/void ones likewise. Re-emails the updated
// quote unless sendEmail=false. Validity restarts from today.
export async function updateQuote(quoteId, { name, email, items, bundlePct = 0, cashDeal = null, freeDelivery = false, addHst = true, daysValid = 14, memo, sendEmail = true }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureSchema();
  const { rows: ex } = await query('SELECT id, number, status FROM quotes WHERE id = $1', [Number(quoteId)]);
  if (!ex.length) throw new Error('Quote not found.');
  if (ex[0].status !== 'open') {
    throw new Error(ex[0].status === 'accepted'
      ? 'The customer already accepted this quote — convert it to an invoice, or void it and send a new one.'
      : `A ${ex[0].status} quote can't be edited.`);
  }
  const lineItems = cleanItems(items);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive price.');
  const totals = computeTotals(lineItems, { bundlePct, addHst, cashDeal });
  const days = Math.min(Math.max(parseInt(daysValid, 10) || 14, 1), 120);

  const quote = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE quotes SET name=$2, email=$3, retail_subtotal=$4, subtotal=$5, bundle_pct=$6, bundle_price=$7,
              hst=$8, total=$9, cash_deal=$10, free_delivery=$11, memo=$12,
              expires_at=(now() + ($13 || ' days')::interval)::date
        WHERE id=$1 RETURNING number, expires_at`,
      [ex[0].id, name || null, email, totals.retailSubtotal, totals.subtotal, totals.pct, totals.bundlePrice,
       totals.hst, totals.total, totals.cash, !!freeDelivery, memo || null, String(days)]
    );
    await client.query('DELETE FROM quote_items WHERE quote_id = $1', [ex[0].id]);
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO quote_items (quote_id, description, sku, retail, amount) VALUES ($1,$2,$3,$4,$5)',
        [ex[0].id, li.description, li.sku, li.retail, li.amount]
      );
    }
    return { id: ex[0].id, number: rows[0].number, expiresAt: rows[0].expires_at, name, email, freeDelivery: !!freeDelivery, memo, items: lineItems, ...totals };
  });

  if (sendEmail) sendQuoteEmail(quote).catch((e) => console.error('quote email failed', e.message));
  upsertCustomer({ email, name }).catch((e) => console.error('customer upsert failed', e.message));
  return { id: quote.id, number: quote.number, total: totals.total, status: 'open', email, hostedUrl: `${hostedPath(quote.number)}?t=${linkToken('quote', quote.number)}` };
}

// Customer clicked "Accept" on the hosted quote page. Flips open → accepted
// (stock still uncommitted — conversion to an invoice stays the owner's move)
// and pings the owner so they can lock it in. Idempotent on re-clicks.
export async function acceptQuote(number) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureSchema();
  const { rows } = await query('SELECT id, number, name, email, status, total, expires_at FROM quotes WHERE number = $1', [String(number || '').trim()]);
  if (!rows.length) throw new Error('Quote not found.');
  const q = rows[0];
  if (q.status === 'accepted' || q.status === 'converted') return { number: q.number, status: q.status, already: true };
  if (q.status !== 'open') throw new Error('This quote is no longer active — contact us and we’ll refresh it.');
  if (q.expires_at && new Date(q.expires_at) < new Date()) throw new Error('This quote has expired — contact us and we’ll refresh it for you.');

  await query("UPDATE quotes SET status = 'accepted', accepted_at = now() WHERE id = $1 AND status = 'open'", [q.id]);

  // Tell the owner it's time to convert + invoice. Both channels best-effort.
  const who = q.name ? `${q.name} (${q.email})` : q.email;
  notifyOwner(
    `Quote accepted: ${q.number} — ${money(Number(q.total))}`,
    `<p><b>${esc(who)}</b> accepted quote <b>${q.number}</b> for <b>${money(Number(q.total))}</b>.</p>
     <p>Next step: open <a href="https://bargainbay.ca/admin/quotes">Quotes</a> and hit <b>Convert</b> to send the invoice and commit the stock.</p>`
  ).catch((e) => console.error('accept notify email failed', e.message));
  const tgTarget = process.env.SARAH_TELEGRAM_MGMT_GROUP ||
    (process.env.SARAH_TELEGRAM_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (tgTarget && process.env.TELEGRAM_BOT_TOKEN) {
    tgSend(tgTarget, `💰 Quote accepted: ${q.number} — ${money(Number(q.total))} by ${who}. Convert it in /admin/quotes to invoice + lock the stock.`)
      .catch((e) => console.error('accept notify telegram failed', e.message));
  }
  return { number: q.number, status: 'accepted', total: Number(q.total) };
}

// A customer's own quotes, for their account page.
export async function quotesForEmail(email) {
  if (!hasDb()) return [];
  await ensureSchema();
  const { rows } = await query(
    `SELECT id, number, status, total, expires_at, created_at FROM quotes
      WHERE lower(email) = lower($1) AND number IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
    [String(email || '').trim()]
  );
  return rows.map((r) => ({
    id: r.id, number: r.number, status: r.status, total: Number(r.total) || 0,
    expires: r.expires_at ? r.expires_at.toISOString().slice(0, 10) : null,
    created: r.created_at ? r.created_at.toISOString() : null
  }));
}

// Void a quote created in error (or a customer request that's been priced &
// re-sent). Doesn't touch stock.
export async function voidQuote(quoteId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureSchema();
  const { rows } = await query(
    "UPDATE quotes SET status = 'void' WHERE id = $1 AND status IN ('open','accepted','expired') RETURNING id, number", [quoteId]
  );
  return rows[0] || null;
}

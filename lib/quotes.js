// Package quotes — DB-backed, non-binding, and inventory-safe. The owner builds
// a quote in /admin/quotes; the client gets a hosted page + email with the
// itemized bundle breakdown. A quote holds NO stock — the units stay live and
// sellable for everyone — until the owner converts it into an invoice, which is
// the only point inventory actually gets reserved/sold. Mirrors lib/invoices.js.
import { hasDb, query, withTransaction } from './db';
import { round2, HST_RATE } from './constants';
import { createAndSendInvoice } from './invoices';
import { sendQuoteEmail } from './email';

function hostedPath(number) {
  return number ? `/quote/${encodeURIComponent(number)}` : null;
}

const clampPct = (v) => Math.min(Math.max(Number(v) || 0, 0), 90);

// The single source of truth for the bundle math. Used by create (authoritative)
// so we never trust client-sent totals.
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

// items: [{ description, amount, retail?, sku? }] where amount = our price (DOLLARS).
export async function createAndSendQuote({ name, email, items, bundlePct = 0, cashDeal = null, freeDelivery = false, addHst = true, daysValid = 14, memo }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');

  const lineItems = (items || [])
    .map((it) => ({
      description: String(it.description || '').trim().slice(0, 500),
      amount: round2(Number(it.amount)),
      retail: round2(Number(it.retail) || 0),
      sku: String(it.sku || '').trim() || null
    }))
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive price.');

  const t = computeTotals(lineItems, { bundlePct, addHst, cashDeal });
  const days = Math.min(Math.max(parseInt(daysValid, 10) || 14, 1), 120);

  const quote = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO quotes (email, name, status, retail_subtotal, subtotal, bundle_pct, bundle_price, hst, total, cash_deal, free_delivery, memo, expires_at)
       VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11,(now() + ($12 || ' days')::interval)::date)
       RETURNING id`,
      [email, name || null, t.retailSubtotal, t.subtotal, t.pct, t.bundlePrice, t.hst, t.total, t.cash, !!freeDelivery, memo || null, String(days)]
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE quotes SET number = 'Q-' || (1000 + id) WHERE id = $1 RETURNING number, expires_at`,
      [id]
    );
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO quote_items (quote_id, description, sku, retail, amount) VALUES ($1,$2,$3,$4,$5)',
        [id, li.description, li.sku, li.retail, li.amount]
      );
    }
    return { id, number: num[0].number, expiresAt: num[0].expires_at, name, email, freeDelivery: !!freeDelivery, memo, items: lineItems, ...t };
  });

  // Email the client their quote (best-effort — don't fail the create if mail
  // hiccups; the owner still has the record + shareable link).
  sendQuoteEmail(quote).catch((e) => console.error('quote email failed', e.message));

  return { id: quote.id, number: quote.number, total: t.total, status: 'open', email, hostedUrl: hostedPath(quote.number) };
}

export async function listQuotes(limit = 25) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, number, email, name, status, total, free_delivery, expires_at, converted_invoice_id, created_at
       FROM quotes ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number || '(draft)',
    email: r.email,
    name: r.name,
    total: Number(r.total) || 0,
    status: r.status,
    freeDelivery: r.free_delivery,
    hostedUrl: hostedPath(r.number),
    expires: r.expires_at ? r.expires_at.toISOString().slice(0, 10) : null,
    convertedInvoiceId: r.converted_invoice_id,
    created: r.created_at ? r.created_at.toISOString() : null
  }));
}

export async function getQuoteByNumber(number) {
  if (!hasDb()) return null;
  const { rows } = await query('SELECT * FROM quotes WHERE number = $1', [number]);
  if (!rows.length) return null;
  const q = rows[0];
  const { rows: items } = await query(
    'SELECT id, description, sku, retail, amount FROM quote_items WHERE quote_id = $1 ORDER BY id',
    [q.id]
  );
  return { ...q, items };
}

// Turn an open/accepted quote into an invoice — the moment stock is committed.
// The bundle discount is distributed across the line items so the invoice's own
// subtotal lands on the bundle price (HST + total then match the quote). The
// SKUs ride along so marking the invoice paid delists those units. Idempotent:
// a quote that's already converted returns its existing invoice.
export async function convertQuoteToInvoice(quoteId) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (!rows.length) throw new Error('Quote not found.');
  const q = rows[0];
  if (q.status === 'converted' && q.converted_invoice_id) {
    const { rows: inv } = await query('SELECT number FROM invoices WHERE id = $1', [q.converted_invoice_id]);
    return { alreadyConverted: true, invoiceId: q.converted_invoice_id, invoiceNumber: inv[0]?.number, invoiceUrl: inv[0]?.number ? `/invoice/${encodeURIComponent(inv[0].number)}` : null };
  }
  if (!['open', 'accepted', 'expired'].includes(q.status)) {
    throw new Error(`A ${q.status} quote can't be converted.`);
  }
  const { rows: items } = await query('SELECT description, sku, amount FROM quote_items WHERE quote_id = $1 ORDER BY id', [quoteId]);
  if (!items.length) throw new Error('Quote has no line items.');

  const subtotal = Number(q.subtotal) || items.reduce((a, it) => a + Number(it.amount), 0);
  const bundlePrice = Number(q.bundle_price) || subtotal;
  const ratio = subtotal > 0 ? bundlePrice / subtotal : 1;
  let running = 0;
  const scaled = items.map((it) => {
    const amt = round2(Number(it.amount) * ratio);
    running = round2(running + amt);
    return { description: it.description, sku: it.sku || null, amount: amt };
  });
  // Push any rounding drift onto the last line so the invoice subtotal equals
  // the bundle price exactly.
  const drift = round2(bundlePrice - running);
  if (drift !== 0 && scaled.length) {
    scaled[scaled.length - 1].amount = round2(scaled[scaled.length - 1].amount + drift);
  }

  const memoParts = [];
  if (q.number) memoParts.push(`Converted from quote ${q.number}.`);
  if (Number(q.bundle_pct) > 0) memoParts.push(`${Number(q.bundle_pct)}% bundle discount applied.`);
  if (q.free_delivery) memoParts.push('Free delivery included.');
  if (q.memo) memoParts.push(q.memo);

  const invoice = await createAndSendInvoice({
    name: q.name,
    email: q.email,
    items: scaled,
    addHst: Number(q.hst) > 0,
    daysUntilDue: 14,
    memo: memoParts.join(' ')
  });

  await query("UPDATE quotes SET status = 'converted', converted_invoice_id = $2 WHERE id = $1", [quoteId, invoice.id]);
  return { invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceUrl: invoice.hostedUrl, total: invoice.total };
}

// Void a quote created in error (or that the client passed on). Doesn't touch stock.
export async function voidQuote(quoteId) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    "UPDATE quotes SET status = 'void' WHERE id = $1 AND status IN ('open','accepted','expired') RETURNING id, number",
    [quoteId]
  );
  return rows[0] || null;
}

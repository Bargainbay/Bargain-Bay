// What the Manager can DO beyond the original short list (owner, 2026-11-17: "act
// like a manager"): prices, invoices, payments, the tracker, deliveries, routes.
//
// Every executor wraps the function the admin screens already call — there is no
// second way to move money, so the phone and the screens cannot disagree. WHEN each
// may run is lib/manager-policy.js's `TOOL_TIER`, enforced by runTool in
// lib/manager-call.js (a gated tool needs a read-back and a yes on a later turn).
// Nothing here is reachable except from a call the owner (or Ravi) is on.
//
// THE LINE: it never moves money out of the bank, never changes who has access,
// never deletes a record. Refunds go through refundInvoiceAmount (money only — it
// moves no stock); voids and discounts are `owner` tier (his instruction only).
import { query } from './db';
import { TOOLS_B, TOOL_B_NAMES, runToolB, readBackB, amountOfB } from './manager-tools-b';
import { logAction } from './manager-actions';
import { torontoDay } from './manager-business';
import {
  TRACKER_FREE_FIELDS, TRACKER_PRICE_FIELDS, stalePricing, ageDays, STALE_DAYS, moneyWords
} from './manager-policy';

const BY = 'Manager (AI)';
const BY_EMAIL = 'manager@bargainbay.ca';
const SESSION = { email: BY_EMAIL, name: BY };
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : NaN; };
const r2 = (n) => Math.round(n * 100) / 100;
const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };

async function audited(entity, entityId, action, summary, detail) {
  try { const { audit } = await import('./audit'); await audit(SESSION, { action, entity, entityId, summary, detail }); } catch { /* never fails the action */ }
}
const said = (callId, dept, kind, summary, detail = {}) =>
  logAction({ kind, summary, detail: { ...detail, dept }, via: 'voice' });

// ── Definitions (the model reads these) ─────────────────────────────────────
const S = (description, props = {}, required = []) => ({ type: 'object', description, properties: props, required });
const str = (d) => ({ type: 'string', description: d });
const numb = (d) => ({ type: 'number', description: d });

export const TOOLS = [
  { name: 'find_invoice', description: 'Look up invoices by number, customer name, email, phone, SKU or memo. Shows number, customer, status, total and what is still owing. Read only.', input_schema: S('', { q: str('What to search for.') }, ['q']) },
  { name: 'find_unit', description: 'Look up a unit by SKU, make, model or title. Shows its list price, retail, cost and condition (he is the owner, so cost is fine to say). Read only.', input_schema: S('', { q: str('SKU, model or words.') }, ['q']) },
  { name: 'stale_stock', description: `Units on sale that have sat ${STALE_DAYS} days or more with a healthy margin, each with a suggested lower price. Use this to raise price cuts with him: say the age, the margin, and your suggested price, then ask. Read only.`, input_schema: S('') },
  { name: 'set_list_price', description: 'Mark a unit DOWN to a new retail (list) price. Only ever lower than the tracker price; to raise, edit Retail or Condition on the tracker instead. Pricing: proposed first, runs after his yes. It will refuse to go under what we owe a vendor on consigned stock.', input_schema: S('', { sku: str('The unit SKU.'), price: numb('New list price in dollars, before tax.') }, ['sku', 'price']) },
  { name: 'set_reseller_price', description: 'Set the price a reseller (member) pays for ONE unit. It is held between the cost floor and the public price. Pricing: proposed first, runs after his yes.', input_schema: S('', { sku: str(''), price: numb('Reseller price in dollars, before tax.') }, ['sku', 'price']) },
  { name: 'back_to_tracker_price', description: 'Remove a unit\'s markdown so it sells at its tracker price again. Pricing: proposed first, runs after his yes.', input_schema: S('', { sku: str('') }, ['sku']) },
  { name: 'edit_tracker_cell', description: 'Fix a NON-price cell on the master tracker (Google Sheet): notes, vendor, lot, category, description, make, model or serial. Done at once and reported. Prices and conditions use edit_tracker_price_cell.', input_schema: S('', { sku: str('Item ID.'), field: { type: 'string', enum: [...TRACKER_FREE_FIELDS] }, value: str('The new text.') }, ['sku', 'field', 'value']) },
  { name: 'edit_tracker_price_cell', description: 'Change a unit\'s Retail or Condition on the master tracker. These set what it sells for, so: proposed first, runs after his yes.', input_schema: S('', { sku: str(''), field: { type: 'string', enum: ['retail', 'condition'] }, value: str('Retail as a number, or the exact condition label.') }, ['sku', 'field', 'value']) },
  { name: 'set_tracker_status', description: 'Change a unit\'s Status on the tracker to one that is already used there (e.g. Sold, Salvage, Tested Working). Proposed first, runs after his yes.', input_schema: S('', { sku: str(''), status: str('A status exactly as the tracker spells it.') }, ['sku', 'status']) },
  { name: 'mark_invoice_paid', description: 'Mark an invoice (or web order) paid in full. Money: proposed first, runs after his yes. For payments you have verified from the e-transfer email, scan_payments does this by itself.', input_schema: S('', { number: str('Invoice number, e.g. INV-1204.'), method: { type: 'string', enum: ['etransfer', 'cash', 'card', 'cheque', 'other'] }, date: str('YYYY-MM-DD the money arrived. Default today.') }, ['number']) },
  { name: 'record_payment', description: 'Record a part-payment or deposit against an invoice. Money: proposed first, runs after his yes.', input_schema: S('', { number: str(''), amount: numb(''), method: { type: 'string', enum: ['etransfer', 'cash', 'card', 'cheque', 'other'] }, date: str('YYYY-MM-DD') }, ['number', 'amount']) },
  { name: 'void_invoice', description: 'Void an invoice. ONLY when HE tells you to — never suggest it as something you will do. Proposed first, runs after his yes.', input_schema: S('', { number: str('') }, ['number']) },
  { name: 'refund_invoice', description: 'Refund money against an invoice (money only, no stock moves). ONLY when HE tells you to. Capped at what was collected. Proposed first, runs after his yes.', input_schema: S('', { number: str(''), amount: numb('Dollars to refund, tax included.'), reason: str('Why, in a few words.') }, ['number', 'amount']) },
  { name: 'apply_discount', description: 'Take an amount off an invoice with a discount line. ONLY when HE tells you to. Proposed first, runs after his yes.', input_schema: S('', { number: str(''), amount: numb('Dollars off (a positive number).'), reason: str('Shown on the invoice, e.g. "Goodwill discount".') }, ['number', 'amount']) },
  { name: 'scan_payments', description: 'Read the e-transfer confirmations in the service mailbox, match each to what it paid for, and mark paid the ones that match exactly on amount, date and name. Anything that does not match cleanly is kept for him. Does it now and reports.', input_schema: S('') },
  { name: 'payments_to_review', description: 'The e-transfers that arrived but could not be matched cleanly (name differs, amount fits several, money arrived before the invoice, or nothing owes it). Read only.', input_schema: S('') },
  { name: 'match_flagged_payment', description: 'Apply one of those flagged e-transfers to a named invoice, once he says that is the one. Money: proposed first, runs after his yes.', input_schema: S('', { payment_id: numb('The id from payments_to_review.'), number: str('The invoice number it pays.') }, ['payment_id', 'number']) },
  { name: 'delivery_board', description: 'The delivery stops for a day (default today): number, customer, city, driver, order in the run, window, status and the charge. Read only.', input_schema: S('', { date: str('YYYY-MM-DD. Default today.') }) },
  { name: 'stop_details', description: 'Everything on one stop: address, window, services, items, driver, status, charge, pay and notes. Read only.', input_schema: S('', { job_number: str('e.g. RS-1596') }, ['job_number']) },
  { name: 'set_stop_window', description: 'Change a stop\'s delivery window. Done at once and reported.', input_schema: S('', { job_number: str(''), start: str('HH:MM 24-hour, e.g. 12:30'), end: str('HH:MM 24-hour') }, ['job_number', 'start', 'end']) },
  { name: 'reorder_run', description: 'Put one driver\'s stops for a day in a new order (first stop first). Done at once and reported. Use plan_run first if he wants it routed.', input_schema: S('', { driver_name: str(''), date: str('YYYY-MM-DD'), job_numbers: { type: 'array', items: { type: 'string' }, description: 'Every stop in the run, in order.' } }, ['driver_name', 'date', 'job_numbers']) },
  { name: 'set_stop_charge', description: 'Set what the CLIENT is charged for a stop (price). Pricing: proposed first, runs after his yes. Use price_stop to work it out from the rate sheet.', input_schema: S('', { job_number: str(''), amount: numb('Dollars, before tax.'), note: str('Short reason.') }, ['job_number', 'amount']) },
  { name: 'set_stop_pay', description: 'Set what the driver is OWED for a stop. Money: proposed first, runs after his yes.', input_schema: S('', { job_number: str(''), amount: numb('Dollars.'), note: str('') }, ['job_number', 'amount']) },
  { name: 'plan_run', description: 'Work out the best order for a driver\'s day from a base (default CDA in Kitchener) back to a finishing point (default the Pickering warehouse), with driving km from the base and the rate-sheet price for each stop. Changes nothing; to apply the order, call reorder_run.', input_schema: S('', { driver_name: str(''), date: str('YYYY-MM-DD'), start: { type: 'string', enum: ['cda', 'warehouse'] }, end: { type: 'string', enum: ['cda', 'warehouse'] } }, ['driver_name', 'date']) },
  { name: 'price_stop', description: 'Price one stop from the delivery rate sheet by driving km from CDA plus its services. All CDA deliveries are white glove (full zone rate). A CDA exchange is billed as two haul-aways. Says what it assumed and what it could not tell. Read only.', input_schema: S('', { job_number: str(''), km: numb('Driving km from CDA if you know it; otherwise plan_run gives it.'), pieces: numb('Pieces on the stop, if more than 2.'), exchange: { type: 'boolean' }, haul_away: numb('Haul-aways.'), fridge_door_removal: numb(''), home_door_removal: numb(''), internal_move: numb(''), overweight: numb('Products over 350 lb.'), install: str('Install type if known: laundry, stacked_laundry, dishwasher, wall_oven, gas_dryer_or_range, otr_microwave, fridge_waterline_existing, fridge_waterline_new.') }, ['job_number']) },
  { name: 'switch_department', description: 'Change hats for the rest of the call: "delivery" (Delivery Manager), "sales" (Sales Manager) or "gm" (General Manager).', input_schema: S('', { dept: { type: 'string', enum: ['gm', 'delivery', 'sales'] } }, ['dept']) }
];
TOOLS.push(...TOOLS_B);
export const NEW_TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// ── Helpers ─────────────────────────────────────────────────────────────────
async function invoiceOf(number) {
  const { getInvoiceByNumber } = await import('./invoices');
  const n = String(number || '').trim().toUpperCase();
  const inv = await getInvoiceByNumber(n);
  return inv || null;
}
async function jobOf(jobNumber) {
  const { rows } = await query('SELECT * FROM jobs WHERE upper(job_number) = upper($1)', [String(jobNumber || '').trim()]);
  return rows[0] || null;
}
async function driverByName(name) {
  const { listDriverOptions } = await import('./manager-actions');
  const hits = (await listDriverOptions()).filter((d) => String(d.name || '').toLowerCase().includes(String(name || '').trim().toLowerCase()));
  if (!hits.length) return { error: `I do not have a driver called ${name}.` };
  if (hits.length > 1) return { error: `More than one driver matches ${name}: ${hits.map((d) => d.name).join(', ')}. Which one?` };
  return { driver: hits[0] };
}
const METHOD = { etransfer: 'etransfer', cash: 'cash', card: 'card', cheque: 'cheque', other: 'other' };

export async function applyPaymentToInvoice(inv, { amount, method = 'etransfer', date, note }) {
  const isWeb = String(inv.channel || '') === 'web' && inv.order_id;
  const { recordInvoicePayment } = await import('./invoices');
  if (isWeb && Math.abs(amount - Number(inv.balance)) < 0.005) {
    // A web sale: the ORDER leads and the invoice follows (CLAUDE.md), so confirm
    // the order the way the orders board does and the invoice mirrors it.
    const { updateOrderStatus } = await import('./orders');
    await updateOrderStatus(inv.order_id, 'confirmed');
    return { via: 'order', number: inv.number };
  }
  await recordInvoicePayment(inv.id, { amount, method: METHOD[method] || 'etransfer', paidDate: date || undefined, note });
  return { via: 'invoice', number: inv.number };
}

// ── Executors ───────────────────────────────────────────────────────────────
export async function runNewTool(name, input = {}, ctx = {}) {
  const dept = ctx.dept || 'gm';
  switch (name) {
    case 'find_invoice': {
      const { listInvoices } = await import('./invoices');
      const r = await listInvoices({ q: input.q, limit: 6 });
      return { found: (r.invoices || []).map((i) => ({ number: i.number, customer: i.name, status: i.status, total: i.total, owing: i.balance ?? null, date: i.created_at || i.date || null })), total: r.total };
    }
    case 'find_unit': {
      const { searchCatalog } = await import('./clearance');
      const hits = await searchCatalog(input.q, 8);
      const skus = hits.map((h) => h.sku);
      const { rows } = skus.length ? await query('SELECT sku, cost::float AS cost, condition, price::float AS tracker_price FROM products WHERE sku = ANY($1::text[])', [skus]) : { rows: [] };
      const by = Object.fromEntries(rows.map((r) => [r.sku, r]));
      return { units: hits.map((h) => ({ ...h, cost: by[h.sku]?.cost ?? null, condition: by[h.sku]?.condition ?? null, trackerPrice: by[h.sku]?.tracker_price ?? null })) };
    }
    case 'stale_stock': {
      const { sheetsConfigured, readTrackerRows } = await import('./sheets');
      if (!sheetsConfigured()) return { error: 'I cannot read the tracker from here.' };
      const rows = await readTrackerRows();
      const { rows: prods } = await query('SELECT sku, price::float AS price, cost::float AS cost, make, model FROM products WHERE active = true');
      const by = Object.fromEntries(prods.map((p) => [p.sku, p]));
      const out = [];
      for (const t of rows) {
        const p = by[t.sku]; if (!p) continue;
        const age = ageDays(t.dateReceived);
        const s = stalePricing({ price: p.price, cost: p.cost, ageDays: age });
        if (s) out.push({ sku: t.sku, unit: `${p.make || ''} ${p.model || ''}`.trim(), ...s });
      }
      out.sort((a, b) => b.margin - a.margin);
      return { count: out.length, units: out.slice(0, 8), note: 'Suggestions only; he answers with his own number for list and reseller.' };
    }
    case 'set_list_price': {
      const sku = String(input.sku || '').trim(); const price = num(input.price);
      if (!sku || !(price > 0)) return { error: 'I need a SKU and a price.' };
      const { rows } = await query('SELECT sku, price::float AS price FROM products WHERE sku = $1', [sku]);
      if (!rows.length) return { error: `I cannot find ${sku}.` };
      if (price >= rows[0].price) return { error: `${sku} is listed at ${moneyWords(rows[0].price)}; this tool only marks a unit down. To raise a price, change its Retail or Condition on the tracker.` };
      const { consignmentFloors } = await import('./consignment');
      const f = (await consignmentFloors([sku]).catch(() => new Map())).get(sku);
      if (f && f.floor > 0 && price + 0.005 < f.floor) return { error: `${sku} is a vendor's drop-off; we owe ${moneyWords(f.cost)} on it, so it cannot go under ${moneyWords(f.floor)}.` };
      const { upsertClearance } = await import('./clearance');
      const r = await upsertClearance({ sku, price, note: 'Set by the Manager on the owner\'s instruction' });
      if (r && r.found === false) return { error: `No product with SKU ${sku}.` };
      await audited('clearance', sku, 'clearance.set', `Manager set list price ${moneyWords(price)}`, { price });
      await said(ctx.callId, dept, 'set_list_price', `set the list price of ${sku} to ${moneyWords(price)} (was ${moneyWords(rows[0].price)})`, { sku, price });
      return { ok: true, said: `${sku} is now ${moneyWords(price)}` };
    }
    case 'set_reseller_price': {
      const { setOverride } = await import('./member-rates');
      const r = await setOverride(input.sku, input.price);
      if (r.error) return { error: r.error };
      await audited('member_price', String(input.sku), 'member_price.set', `Manager set reseller price ${moneyWords(r.price)}`, { before: r.before, price: r.price });
      await said(ctx.callId, dept, 'set_reseller_price', `set the reseller price of ${input.sku} to ${moneyWords(r.price)}${r.before ? ` (was ${moneyWords(r.before)})` : ''}`, { sku: input.sku, price: r.price });
      return { ok: true, said: `the reseller price of ${input.sku} is now ${moneyWords(r.price)}` };
    }
    case 'back_to_tracker_price': {
      const { removeClearance } = await import('./clearance');
      const removed = await removeClearance(String(input.sku || '').trim());
      await audited('clearance', String(input.sku), 'clearance.remove', 'Manager removed the markdown', {});
      await said(ctx.callId, dept, 'back_to_tracker_price', `put ${input.sku} back to its tracker price`, { sku: input.sku });
      return { ok: true, said: removed ? `${input.sku} is back to its tracker price` : `${input.sku} had no markdown` };
    }
    case 'edit_tracker_cell':
    case 'edit_tracker_price_cell': {
      const field = String(input.field || '');
      const allowed = name === 'edit_tracker_cell' ? TRACKER_FREE_FIELDS : new Set(['retail', 'condition']);
      if (!allowed.has(field)) return { error: name === 'edit_tracker_cell' && TRACKER_PRICE_FIELDS.has(field) ? 'That changes a price, so it needs edit_tracker_price_cell and his yes.' : `I cannot edit "${field}".` };
      const { sheetsConfigured, readTrackerRows, writeTrackerCells } = await import('./sheets');
      if (!sheetsConfigured()) return { error: 'I cannot reach the tracker from here, so nothing was changed.' };
      const rows = await readTrackerRows();
      const row = rows.find((r) => r.sku.toLowerCase() === String(input.sku || '').trim().toLowerCase());
      if (!row) return { error: `${input.sku} is not on the tracker.` };
      const value = field === 'retail' ? num(input.value) : String(input.value ?? '').trim();
      if (field === 'retail' && !(value > 0)) return { error: 'Retail has to be a dollar amount.' };
      const before = row[field] ?? '';
      const w = await writeTrackerCells([{ row: row.row, field, value }]);
      if (!w.written) return { error: `The tracker has no "${field}" column I can write to, so nothing changed.` };
      await said(ctx.callId, dept, name, `changed ${field} on ${row.sku} from "${before}" to "${value}" on the tracker`, { sku: row.sku, field, before, value });
      return { ok: true, said: `${row.sku} ${field} is now ${value} on the tracker`, before };
    }
    case 'set_tracker_status': {
      const { sheetsConfigured, readTrackerRows, writeTrackerCells } = await import('./sheets');
      if (!sheetsConfigured()) return { error: 'I cannot reach the tracker from here, so nothing was changed.' };
      const rows = await readTrackerRows();
      const known = [...new Set(rows.map((r) => r.status).filter(Boolean))];
      const exact = known.find((s) => s.toLowerCase() === String(input.status || '').trim().toLowerCase());
      if (!exact) return { error: `The tracker does not use "${input.status}". It uses: ${known.slice(0, 10).join(', ')}.` };
      const row = rows.find((r) => r.sku.toLowerCase() === String(input.sku || '').trim().toLowerCase());
      if (!row) return { error: `${input.sku} is not on the tracker.` };
      await writeTrackerCells([{ row: row.row, field: 'status', value: exact }]);
      await said(ctx.callId, dept, 'set_tracker_status', `set ${row.sku} to "${exact}" on the tracker (was "${row.status}")`, { sku: row.sku, before: row.status, status: exact });
      return { ok: true, said: `${row.sku} is now ${exact}` };
    }
    case 'mark_invoice_paid':
    case 'record_payment': {
      const inv = await invoiceOf(input.number);
      if (!inv) return { error: `I cannot find invoice ${input.number}.` };
      if (!['open', 'partial'].includes(inv.status)) return { error: `${inv.number} is ${inv.status}, so there is nothing to pay.` };
      const amount = name === 'mark_invoice_paid' ? Number(inv.balance) : num(input.amount);
      if (!(amount > 0) || amount > Number(inv.balance) + 0.005) return { error: `${inv.number} is owed ${moneyWords(inv.balance)}; that amount does not fit.` };
      // A second payment needs a second e-transfer: an e-transfer entry must be backed by a bank email nothing else has used.
      let backing = null;
      if ((input.method || 'etransfer') === 'etransfer') {
        const { etransferBacking } = await import('./manager-payments');
        backing = await etransferBacking(amount);
        if (!backing.ok) return { error: `I will not record an e-transfer on ${inv.number} because ${backing.reason}. If it was cash, a cheque or a card, tell me and I will record it that way.` };
      }
      const r = await applyPaymentToInvoice(inv, { amount, method: input.method || 'etransfer', date: input.date, note: 'Recorded by the Manager on the owner\'s instruction' });
      if (backing) { const { claimBacking } = await import('./manager-payments'); await claimBacking(backing.msgId, backing.p, inv.number).catch(() => {}); }
      await audited('invoice', inv.number, 'invoice.payment', `Manager recorded ${moneyWords(amount)} on ${inv.number}`, { amount, method: input.method });
      await said(ctx.callId, dept, name, `recorded ${moneyWords(amount)} paid on ${inv.number}`, { number: inv.number, amount });
      return { ok: true, said: `${inv.number} ${Math.abs(amount - Number(inv.balance)) < 0.005 ? 'is paid' : 'has the payment recorded'}`, via: r.via };
    }
    case 'void_invoice': {
      const inv = await invoiceOf(input.number);
      if (!inv) return { error: `I cannot find invoice ${input.number}.` };
      const { voidInvoice } = await import('./invoices');
      await voidInvoice(inv.id);
      await audited('invoice', inv.number, 'invoice.void', `Manager voided ${inv.number} on the owner's instruction`, {});
      await said(ctx.callId, dept, name, `voided ${inv.number}`, { number: inv.number });
      return { ok: true, said: `${inv.number} is voided` };
    }
    case 'refund_invoice': {
      const inv = await invoiceOf(input.number);
      if (!inv) return { error: `I cannot find invoice ${input.number}.` };
      const amount = num(input.amount);
      if (!(amount > 0)) return { error: 'How much to refund?' };
      const { refundInvoiceAmount } = await import('./invoices');
      const r = await refundInvoiceAmount(inv.id, { amount, reason: String(input.reason || 'Refund on the owner\'s instruction').slice(0, 200), by: BY });
      await audited('invoice', inv.number, 'invoice.refund', `Manager refunded ${moneyWords(amount)} on ${inv.number}`, { amount, reason: input.reason });
      await said(ctx.callId, dept, name, `refunded ${moneyWords(amount)} on ${inv.number}`, { number: inv.number, amount });
      return { ok: true, said: `${moneyWords(amount)} refunded on ${inv.number}`, detail: r };
    }
    case 'apply_discount': {
      const inv = await invoiceOf(input.number);
      if (!inv) return { error: `I cannot find invoice ${input.number}.` };
      const amount = num(input.amount);
      if (!(amount > 0)) return { error: 'How much off?' };
      const { fromInvoice, toPayload } = await import('./invoice-lines');
      const { updateInvoice } = await import('./invoices');
      const lines = fromInvoice(inv.items.filter((i) => !i.refunded_at));
      lines.push({ description: String(input.reason || 'Discount').slice(0, 120), amount: String(amount), kind: 'discount', sku: null });
      await updateInvoice(inv.id, {
        items: toPayload(lines), addHst: Number(inv.hst) > 0, taxInclusive: !!inv.tax_inclusive, memo: inv.memo || undefined
      });
      await audited('invoice', inv.number, 'invoice.discount', `Manager took ${moneyWords(amount)} off ${inv.number}`, { amount, reason: input.reason });
      await said(ctx.callId, dept, name, `took ${moneyWords(amount)} off ${inv.number}`, { number: inv.number, amount });
      return { ok: true, said: `${moneyWords(amount)} is off ${inv.number}` };
    }
    case 'scan_payments': {
      const { scanPayments } = await import('./manager-payments');
      return await scanPayments({ dept });
    }
    case 'payments_to_review': {
      const { reviewList } = await import('./manager-payments');
      return { payments: await reviewList() };
    }
    case 'match_flagged_payment': {
      const { applyFlagged } = await import('./manager-payments');
      return await applyFlagged(Number(input.payment_id), String(input.number || ''), { dept, callId: ctx.callId });
    }
    case 'delivery_board': {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? input.date : torontoDay();
      const { rows } = await query(
        `SELECT j.job_number, j.customer_name, j.city, j.status, j.seq, j.window_start, j.window_end, j.charge_amount::float AS charge, u.name AS driver
           FROM jobs j LEFT JOIN users u ON u.id = j.driver_id
          WHERE j.job_date = $1::date AND j.status <> 'cancelled' ORDER BY u.name NULLS FIRST, j.seq NULLS LAST, j.window_start NULLS LAST, j.id`, [date]);
      return { date, stops: rows.map((r) => ({ stop: r.job_number, customer: r.customer_name, city: r.city, driver: r.driver || 'nobody', order: r.seq, window: r.window_start ? `${String(r.window_start).slice(0, 5)}-${String(r.window_end || '').slice(0, 5)}` : null, status: r.status, charge: r.charge })) };
    }
    case 'stop_details': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      const { rows: items } = await query('SELECT description, qty FROM job_items WHERE job_id = $1 ORDER BY id', [j.id]).catch(() => ({ rows: [] }));
      return { stop: j.job_number, status: j.status, customer: j.customer_name, address: [j.address, j.city, j.postal].filter(Boolean).join(', '), date: j.job_date, window: j.window_start ? `${String(j.window_start).slice(0, 5)}-${String(j.window_end || '').slice(0, 5)}` : null, services: j.services, shipment: j.shipment_type, charge: j.charge_amount, pay: j.pay_amount, notes: j.notes, items: items.map((i) => i.description) };
    }
    case 'set_stop_window': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      const s = hhmm(input.start); const e = hhmm(input.end);
      if (!s || !e) return { error: 'I need the window as 24-hour times, like 12:30 to 16:30.' };
      if (s >= e) return { error: 'The window has to end after it starts.' };
      const { updateJob } = await import('./jobs');
      await updateJob(j.id, { windowStart: s, windowEnd: e }, BY);
      await said(ctx.callId, dept, name, `set the window on ${j.job_number} to ${s}-${e}`, { job: j.job_number, start: s, end: e });
      return { ok: true, said: `${j.job_number} window is now ${s} to ${e}` };
    }
    case 'reorder_run': {
      const d = await driverByName(input.driver_name);
      if (d.error) return d;
      const ids = [];
      for (const n of input.job_numbers || []) {
        const j = await jobOf(n);
        if (!j) return { error: `I cannot find a stop numbered ${n}.` };
        ids.push(j.id);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))) return { error: 'Which date?' };
      const { resequence } = await import('./jobs');
      await resequence(d.driver.id, input.date, ids, BY);
      await said(ctx.callId, dept, name, `reordered ${d.driver.name}'s run on ${input.date}: ${(input.job_numbers || []).join(', ')}`, { driver: d.driver.name, date: input.date, order: input.job_numbers });
      return { ok: true, said: `${d.driver.name}'s run is reordered` };
    }
    case 'set_stop_charge':
    case 'set_stop_pay': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      const amount = num(input.amount);
      if (!(amount >= 0)) return { error: 'How much?' };
      const jobs = await import('./jobs');
      const before = name === 'set_stop_charge' ? j.charge_amount : j.pay_amount;
      if (name === 'set_stop_charge') await jobs.setJobCharge(j.id, { amount, note: input.note }, BY); else await jobs.setJobPay(j.id, { amount, note: input.note }, BY);
      await said(ctx.callId, dept, name, `${name === 'set_stop_charge' ? 'charge' : 'driver pay'} on ${j.job_number} set to ${moneyWords(amount)}${before != null ? ` (was ${moneyWords(before)})` : ''}`, { job: j.job_number, amount, before });
      return { ok: true, said: `${j.job_number} ${name === 'set_stop_charge' ? 'charge' : 'pay'} is now ${moneyWords(amount)}` };
    }
    case 'plan_run': {
      const d = await driverByName(input.driver_name);
      if (d.error) return d;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))) return { error: 'Which date?' };
      const { rows } = await query(
        `SELECT id, job_number, address, city, postal, window_start, services, notes, customer_name, shipment_type FROM jobs
          WHERE job_date = $1::date AND driver_id = $2 AND status NOT IN ('done','failed','cancelled') ORDER BY seq NULLS LAST, id`, [input.date, d.driver.id]);
      if (!rows.length) return { error: `${d.driver.name} has no open stops on ${input.date}.` };
      const { planRoute } = await import('./route-plan');
      const { priceDelivery } = await import('./delivery-rates');
      const stops = rows.map((r) => ({ id: r.id, address: r.address, city: r.city, postal: r.postal, windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null }));
      const plan = await planRoute(stops, input.start || 'cda', null, { endKey: input.end || 'warehouse' });
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      const estimated = plan.source !== 'google';
      const out = plan.order.map((id, n) => {
        const r = byId[id]; const leg = plan.legs.find((l) => l.id === id);
        const services = r.services || [];
        const p = leg?.baseKm == null ? null : priceDelivery({ km: leg.baseKm, estimated, services, glove: 'white_glove', exchangeBilling: 'haul_away', installs: [] });
        return { order: n + 1, stop: r.job_number, customer: r.customer_name, city: r.city, window: r.window_start ? String(r.window_start).slice(0, 5) : null, km_from_base: leg?.baseKm ?? null, base_price: p?.total ?? null, price_questions: p?.questions || [] };
      });
      return { driver: d.driver.name, base: plan.base.name, finish: plan.endBase?.name || null, estimate_only: estimated, total_km: plan.totalKm, total_minutes: plan.totalMin, stops: out, note: 'base_price is the zone rate plus an exchange if tagged; add pieces, haul-aways, door removals and installs with price_stop. To apply this order, call reorder_run.' };
    }
    case 'price_stop': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      const { priceDelivery, guessInstall } = await import('./delivery-rates');
      const km = input.km != null ? num(input.km) : NaN;
      if (!(km >= 0)) return { error: 'I need the driving distance from CDA. Run plan_run for this driver and day, or tell me the km.' };
      const services = j.services || [];
      const installType = input.install || (services.includes('install') ? guessInstall(`${j.appliance || ''} ${j.notes || ''}`) : null);
      const p = priceDelivery({
        km, services, pieces: input.pieces, glove: 'white_glove', exchangeBilling: 'haul_away',
        haulAway: input.haul_away, fridgeDoorRemoval: input.fridge_door_removal, homeDoorRemoval: input.home_door_removal,
        internalMove: input.internal_move, overweight: input.overweight, installs: installType ? [{ type: installType }] : []
      });
      return { stop: j.job_number, current_charge: j.charge_amount, ...p };
    }
    case 'switch_department': {
      const dept2 = ['gm', 'delivery', 'sales'].includes(input.dept) ? input.dept : 'gm';
      await query('UPDATE manager_calls SET dept = $2 WHERE id = $1', [Number(ctx.callId), dept2]);
      return { ok: true, dept: dept2, said: `Switched to the ${dept2} hat.` };
    }
    default:
      if (TOOL_B_NAMES.has(name)) return runToolB(name, input, ctx);
      return { error: 'Unknown tool.' };
  }
}

// Read-back for the gated ones — built here so what he hears is what runs.
export function readBackNew(name, i = {}) {
  const m = moneyWords;
  switch (name) {
    case 'set_list_price': return `mark ${i.sku} down to a list price of ${m(i.price)}`;
    case 'set_reseller_price': return `set the reseller price of ${i.sku} to ${m(i.price)}`;
    case 'back_to_tracker_price': return `put ${i.sku} back to its tracker price`;
    case 'edit_tracker_price_cell': return `change ${i.field} on ${i.sku} to ${i.value} on the tracker`;
    case 'set_tracker_status': return `set ${i.sku} to ${i.status} on the tracker`;
    case 'mark_invoice_paid': return `mark ${i.number} paid in full by ${i.method || 'e-transfer'}${i.date ? ` on ${i.date}` : ''}`;
    case 'record_payment': return `record ${m(i.amount)} paid on ${i.number}`;
    case 'void_invoice': return `void invoice ${i.number}`;
    case 'refund_invoice': return `refund ${m(i.amount)} on ${i.number}${i.reason ? ` because ${i.reason}` : ''}`;
    case 'apply_discount': return `take ${m(i.amount)} off ${i.number}${i.reason ? ` as ${i.reason}` : ''}`;
    case 'match_flagged_payment': return `apply payment number ${i.payment_id} to invoice ${i.number}`;
    case 'set_stop_charge': return `set the charge on ${i.job_number} to ${m(i.amount)}`;
    case 'set_stop_pay': return `set the driver pay on ${i.job_number} to ${m(i.amount)}`;
    default: return TOOL_B_NAMES.has(name) ? readBackB(name, i) : name;
  }
}
// The amount a gated call moves, for the "over fifty dollars" read-back.
export function amountOf(name, i = {}) {
  if (['refund_invoice', 'apply_discount', 'record_payment', 'set_stop_pay', 'set_stop_charge'].includes(name)) return Number(i.amount) || 0;
  return amountOfB(name, i);
}

// The Manager's second batch of tools (owner, 2026-11-17: "add the rest of the 100
// tasks"). Same rules as lib/manager-tools.js, which imports this file and lists
// these beside its own:
//   · every executor WRAPS a function the admin screens already call;
//   · WHEN a tool may run is `TOOL_TIER` in lib/manager-policy.js (act / gated /
//     owner), enforced by runTool in lib/manager-call.js;
//   · it never moves money out of the bank, never changes who has access to the
//     systems, never deletes a record, and never writes to a CUSTOMER by itself.
//     Re-sending an invoice or an approval email goes out only on his instruction,
//     after a read-back and a yes.
// This file must not import lib/manager-tools.js (that one imports this).
import { query, hasDb } from './db';
import { logAction } from './manager-actions';
import { torontoDay } from './manager-business';
import { moneyWords } from './manager-policy';

const BY = 'Manager (AI)';
const BY_EMAIL = 'manager@bargainbay.ca';
const SESSION = { email: BY_EMAIL, name: BY };
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : NaN; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function audited(entity, entityId, action, summary, detail) {
  try { const { audit } = await import('./audit'); await audit(SESSION, { action, entity, entityId, summary, detail }); } catch { /* never fails the action */ }
}
const said = (dept, kind, summary, detail = {}) => logAction({ kind, summary, detail: { ...detail, dept }, via: 'voice' });

// A phone call carries a few sentences, not a table. Whatever a screen's loader
// returns is cut to the first few rows and short strings, so the model gets the
// shape and the top of the list, and says the count.
export function brief(x, rows = 8, depth = 0) {
  if (x == null || typeof x === 'number' || typeof x === 'boolean') return x;
  if (typeof x === 'string') return x.length > 160 ? `${x.slice(0, 157)}...` : x;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (Array.isArray(x)) {
    const out = x.slice(0, rows).map((v) => brief(v, rows, depth + 1));
    return x.length > rows ? { count: x.length, first: out } : out;
  }
  if (depth > 3) return '...';
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    if (/password|token|secret|hash|html/i.test(k)) continue;
    o[k] = brief(v, rows, depth + 1);
  }
  return o;
}

const S = (description, props = {}, required = []) => ({ type: 'object', description, properties: props, required });
const str = (d) => ({ type: 'string', description: d });
const numb = (d) => ({ type: 'number', description: d });
const T = (name, description, input_schema = S('')) => ({ name, description, input_schema });

export const TOOLS_B = [
  // ── Reading (done at once) ────────────────────────────────────────────────
  T('find_customer', 'Look up a customer by name, email or phone: spend, orders, notes. Read only.', S('', { q: str('Name, email or phone.') }, ['q'])),
  T('find_quote', 'Look up quotes by number, customer or words: status, total, expiry. Read only.', S('', { q: str('Quote number or customer.') }, ['q'])),
  T('sales_report', 'The daily profit and loss for a date range (revenue, cost of goods, delivery, wages, overhead, net). Read only.', S('', { from: str('YYYY-MM-DD. Default 7 days ago.'), to: str('YYYY-MM-DD. Default today.') })),
  T('hst_position', 'HST charged, credits claimed and what is owed for the month or the quarter. Read only.', S('', { period: { type: 'string', enum: ['month', 'quarter', 'year'] } })),
  T('payables', 'What we owe suppliers: unpaid purchase invoices by how late they are. Read only.'),
  T('stock_gaps', 'The inventory gaps check: units RS Ops holds that are not on the tracker, sales with no unit, units waiting for an invoice. Read only.'),
  T('reorder_list', 'Parts below their reorder level, with what is already on order and a suggested quantity. Read only.'),
  T('abandoned_carts', 'Carts somebody left with a unit still for sale, with who and what. Read only.'),
  T('reseller_applications', 'Reseller applications waiting for a decision, and the current members. Read only.'),
  T('list_coupons', 'Coupon codes, what they take off, uses and whether they are on. Read only.'),
  T('store_credit_balance', 'The balance left on a store credit code. Read only.', S('', { code: str('The code, e.g. SC-ABCD-EFGH.') }, ['code'])),
  T('unit_location', 'Where a unit is standing in the warehouse right now, by SKU. Read only.', S('', { q: str('A SKU, or words to find the unit.') }, ['q'])),
  T('loose_ends', 'Stops from earlier days that nobody closed. Read only.'),
  T('money_at_the_door', 'Cash and payments the drivers reported collecting that nobody has confirmed yet. Read only.'),
  T('follow_ups_due', 'Open follow-ups: overdue, due today and nobody\'s. Read only.'),
  T('affiliate_payout_run', 'Affiliates owed $50 or more and what each is owed. Read only; the payments themselves are sent from the bank by a person.'),
  T('where_are_vans', 'The last known positions of the drivers and the vans, and how fresh each is. Read only.'),
  T('late_stops', 'Today\'s stops whose delivery window has already ended and are not done. Read only.'),
  T('duplicate_customers', 'Customer records that look like the same person. Read only; merging is done on the screen.'),
  T('open_purchase_orders', 'Purchase orders still owed to us, and invoices that do not match their order. Read only.'),
  T('fill_requests', 'Stock invoice lines waiting for his approval to fill units marked NEEDS INVOICE. Read only.'),
  T('health_check', 'When each scheduled job last ran and whether it worked. Read only.'),
  T('morning_brief', 'One pass over the day: stops today and who has none, late stops, overdue invoices, e-transfers to review, and old stock. Use it to open a call or when he asks how it is going. Read only.'),

  // ── Acting at once, reported after ────────────────────────────────────────
  T('add_customer_note', 'Write a dated note on a customer\'s record (what was said or promised). Done at once.', S('', { customer_id: numb('From find_customer.'), body: str('The note.') }, ['customer_id', 'body'])),
  T('complete_follow_up', 'Mark a follow-up task done, with how it went. Done at once.', S('', { task_id: numb('From follow_ups_due.'), outcome: str('How it went, in a few words.') }, ['task_id'])),
  T('move_stop_day', 'Move a stop to another day, keeping its driver. Done at once.', S('', { job_number: str(''), date: str('YYYY-MM-DD') }, ['job_number', 'date'])),
  T('reopen_stop', 'Reopen a finished or cancelled stop (a customer rang back, or it was closed by mistake). Keeps its signature and photos. Done at once.', S('', { job_number: str('') }, ['job_number'])),
  T('move_unit', 'Record that units were moved to a warehouse spot (e.g. L3-2, V1, RECEIVING).', S('', { skus: { type: 'array', items: { type: 'string' } }, code: str('The spot code.') }, ['skus', 'code'])),
  T('post_team_message', 'Post a chat message or a notice to the Team board: General, Sales, Warehouse or Delivery. Done at once.', S('', { channel: { type: 'string', enum: ['general', 'sales', 'warehouse', 'delivery'] }, body: str('The message.'), title: str('A title makes it a pinned-style notice. Leave out for chat.') }, ['channel', 'body'])),
  T('set_quote_lost_reason', 'Record why a quote was lost or expired. Done at once.', S('', { number: str('Quote number.'), reason: str('One of: price, competitor, changed_mind, no_answer, stock, delivery, other.'), note: str('') }, ['number', 'reason'])),
  T('set_reorder_point', 'Set when a part is reordered: the level and how many to buy. Done at once.', S('', { part_id: numb(''), point: numb('Reorder when available is at or below this.'), qty: numb('How many to order.') }, ['part_id', 'point'])),
  T('raise_cart_follow_ups', 'Turn quiet abandoned carts into follow-up tasks for the sales team. Raises one per customer; never emails anybody.'),
  T('book_revisit', 'Book another visit on an open service call. Done at once.', S('', { ticket_id: numb('') }, ['ticket_id'])),

  // ── Proposed first, run after his yes ─────────────────────────────────────
  T('resend_invoice', 'Email an invoice to the customer again. It goes to a CUSTOMER, so only on his instruction. Proposed first, runs after his yes.', S('', { number: str('') }, ['number'])),
  T('convert_quote', 'Turn a quote into an invoice. This raises a sale and holds the units. Proposed first, runs after his yes.', S('', { number: str('Quote number.') }, ['number'])),
  T('void_quote', 'Close a quote as lost. Proposed first, runs after his yes.', S('', { number: str(''), reason: str('') }, ['number'])),
  T('set_coupon_active', 'Turn a coupon code on or off. It changes what the shop charges. Proposed first, runs after his yes.', S('', { coupon_id: numb('From list_coupons.'), active: { type: 'boolean' } }, ['coupon_id', 'active'])),
  T('decide_reseller', 'Approve or reject a reseller application. Proposed first, runs after his yes.', S('', { user_id: numb('From reseller_applications.'), decision: { type: 'string', enum: ['approve', 'reject'] } }, ['user_id', 'decision'])),
  T('cancel_stop', 'Cancel a delivery stop. Proposed first, runs after his yes.', S('', { job_number: str(''), reason: str('') }, ['job_number', 'reason'])),
  T('confirm_door_money', 'Confirm money a driver reported collecting, optionally at the amount actually counted. This marks the invoice paid. Proposed first, runs after his yes.', S('', { collection_id: numb('From money_at_the_door.'), amount: numb('The amount counted, if different.') }, ['collection_id'])),
  T('reject_door_money', 'Say money a driver reported never arrived. The invoice stays owing. Proposed first, runs after his yes.', S('', { collection_id: numb(''), note: str('') }, ['collection_id'])),
  T('approve_fill_requests', 'Approve filling NEEDS INVOICE tracker rows with a supplier invoice\'s cost. It writes cost and retail to the tracker. Proposed first, runs after his yes.', S('', { ids: { type: 'array', items: { type: 'number' } } }, ['ids'])),
  T('reject_fill_requests', 'Reject those fill requests; the invoice lines are added as new units instead. Proposed first, runs after his yes.', S('', { ids: { type: 'array', items: { type: 'number' } }, note: str('') }, ['ids'])),
  T('mark_supplier_bill_paid', 'Record that a supplier\'s purchase invoice was paid. It records the payment; it does not send money. Proposed first, runs after his yes.', S('', { purchase_invoice_id: numb('From payables.'), date: str('YYYY-MM-DD it was paid. Default today.') }, ['purchase_invoice_id'])),
  T('record_affiliate_payout', 'Record an e-transfer to an affiliate that a person has ALREADY sent. It moves no money. Proposed first, runs after his yes.', S('', { affiliate_id: numb(''), amount: numb(''), reference: str('The e-transfer reference.') }, ['affiliate_id', 'amount', 'reference'])),

  // ── Only on his instruction ───────────────────────────────────────────────
  T('issue_store_credit', 'Issue a store credit code for an amount. ONLY when HE tells you to. Proposed first, runs after his yes.', S('', { amount: numb(''), name: str(''), email: str(''), invoice_number: str('The sale it comes from, if any.') }, ['amount'])),
  T('apply_store_credit', 'Use a store credit code against an invoice. ONLY when HE tells you to. Proposed first, runs after his yes.', S('', { number: str('Invoice number.'), code: str(''), amount: numb('Leave out to use as much as the invoice needs.') }, ['number', 'code']))
];
export const TOOL_B_NAMES = new Set(TOOLS_B.map((t) => t.name));

// ── Helpers ─────────────────────────────────────────────────────────────────
async function jobOf(jobNumber) {
  const { rows } = await query('SELECT * FROM jobs WHERE upper(job_number) = upper($1)', [String(jobNumber || '').trim()]);
  return rows[0] || null;
}
async function invoiceOf(number) {
  const { getInvoiceByNumber } = await import('./invoices');
  return (await getInvoiceByNumber(String(number || '').trim().toUpperCase())) || null;
}
async function quoteOf(number) {
  const { getQuoteByNumber } = await import('./quotes');
  return (await getQuoteByNumber(String(number || '').trim().toUpperCase())) || null;
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export async function runToolB(name, input = {}, ctx = {}) {
  const dept = ctx.dept || 'gm';
  switch (name) {
    // ── reads ──
    case 'find_customer': {
      const { listCustomers } = await import('./customers');
      const rows = await listCustomers({ q: String(input.q || ''), limit: 5 });
      return { customers: brief(rows, 5) };
    }
    case 'find_quote': {
      const { listQuotes } = await import('./quotes');
      const q = String(input.q || '').toLowerCase();
      const all = await listQuotes(200);
      const list = Array.isArray(all) ? all : (all?.quotes || []);
      const hit = list.filter((x) => JSON.stringify([x.number, x.name, x.email, x.status]).toLowerCase().includes(q));
      return { count: hit.length, quotes: brief(hit.slice(0, 6).map((x) => ({ number: x.number, customer: x.name, status: x.status, total: x.total, expires: x.expires_at || x.expiry || null })), 6) };
    }
    case 'sales_report': {
      const { dailyPnl } = await import('./daily-pnl');
      const to = isDate(input.to) ? input.to : torontoDay();
      const from = isDate(input.from) ? input.from : daysAgo(7);
      return brief(await dailyPnl({ from, to }), 10);
    }
    case 'hst_position': {
      const { hstRemittance } = await import('./analytics');
      return brief(await hstRemittance(['month', 'quarter', 'year'].includes(input.period) ? input.period : 'month'), 6);
    }
    case 'payables': { const { payablesAging } = await import('./suppliers'); return brief(await payablesAging(), 6); }
    case 'stock_gaps': { const { inventoryGapsReport } = await import('./stock-reconcile'); return brief(await inventoryGapsReport(), 6); }
    case 'reorder_list': { const { reorderReport } = await import('./reorder'); return brief(await reorderReport(), 8); }
    case 'abandoned_carts': { const { abandonedCarts } = await import('./abandoned-carts'); return brief(await abandonedCarts({ limit: 10 }), 8); }
    case 'reseller_applications': {
      const { listMembers } = await import('./members');
      const all = await listMembers();
      const slim = (m) => ({ id: m.id, name: m.name, business: m.business_name, status: m.member_status, requested: m.member_requested_at, orders: m.orders ?? null });
      return { pending: all.filter((m) => m.member_status === 'pending').map(slim), members: all.filter((m) => m.member_status === 'approved').length };
    }
    case 'list_coupons': { const { listCoupons } = await import('./coupons'); return brief(await listCoupons(), 10); }
    case 'store_credit_balance': {
      const { getStoreCredit } = await import('./store-credit');
      const c = await getStoreCredit(input.code);
      return c ? { code: c.code, balance: c.balance, issuedTo: c.issuedToName || c.issuedToEmail || null, fromInvoice: c.invoiceNumber } : { error: 'No store credit has that code.' };
    }
    case 'unit_location': {
      const { unitWhere, findUnits } = await import('./locations');
      const w = await unitWhere(String(input.q || '').trim()).catch(() => null);
      if (w && (w.code || w.location || w.sku)) return brief(w, 4);
      return { matches: brief(await findUnits(String(input.q || '')), 6) };
    }
    case 'loose_ends': { const { staleStops } = await import('./jobs'); return brief(await staleStops(), 8); }
    case 'money_at_the_door': { const { pendingCollectionQueue } = await import('./jobs'); return brief(await pendingCollectionQueue(), 8); }
    case 'follow_ups_due': { const { myDay } = await import('./crm'); return brief(await myDay({ email: BY_EMAIL }), 8); }
    case 'affiliate_payout_run': { const { payoutRun } = await import('./affiliates'); return brief(await payoutRun(), 8); }
    case 'where_are_vans': { const { livePositions } = await import('./driver-location'); return brief(await livePositions(), 8); }
    case 'late_stops': {
      const { rows } = await query(
        `SELECT j.job_number, j.customer_name, j.city, j.status, j.window_end, u.name AS driver
           FROM jobs j LEFT JOIN users u ON u.id = j.driver_id
          WHERE j.job_date = (now() AT TIME ZONE 'America/Toronto')::date
            AND j.status NOT IN ('done','failed','cancelled')
            AND j.window_end IS NOT NULL AND j.window_end < (now() AT TIME ZONE 'America/Toronto')::time
          ORDER BY j.window_end`);
      return { count: rows.length, stops: rows.slice(0, 8).map((r) => ({ stop: r.job_number, customer: r.customer_name, city: r.city, driver: r.driver || 'nobody', windowEnded: String(r.window_end).slice(0, 5), status: r.status })) };
    }
    case 'duplicate_customers': { const { duplicateCandidates } = await import('./customers'); return brief(await duplicateCandidates({ limit: 8 }), 8); }
    case 'open_purchase_orders': {
      const { listPurchaseOrders, matchingGaps } = await import('./purchase-orders');
      return { orders: brief(await listPurchaseOrders({ status: 'outstanding', limit: 10 }), 8), mismatches: brief(await matchingGaps({ limit: 10 }).catch(() => []), 6) };
    }
    case 'fill_requests': { const { listFillRequests } = await import('./stock-reconcile'); return brief(await listFillRequests({ status: 'pending', limit: 20 }), 8); }
    case 'health_check': {
      if (!hasDb()) return { error: 'No database.' };
      const { rows } = await query('SELECT name, last_run_at, last_ok_at, last_status, last_error FROM cron_heartbeats ORDER BY name');
      const bad = rows.filter((r) => !r.last_ok_at || (r.last_run_at && r.last_ok_at < r.last_run_at));
      return { jobs: rows.length, notWorking: bad.map((r) => ({ job: r.name, lastRan: r.last_run_at, lastOk: r.last_ok_at, error: r.last_error })), allClear: !bad.length };
    }
    case 'morning_brief': {
      const out = {};
      const today = torontoDay();
      const safe = async (k, f) => { try { out[k] = await f(); } catch { out[k] = 'could not read'; } };
      await safe('stopsToday', async () => {
        const { rows } = await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE driver_id IS NULL)::int AS nobody, count(*) FILTER (WHERE status = 'done')::int AS done FROM jobs WHERE job_date = $1::date AND status <> 'cancelled'`, [today]);
        return rows[0];
      });
      await safe('lateStops', async () => (await runToolB('late_stops', {}, ctx)).count);
      await safe('overdueInvoices', async () => {
        const { rows } = await query(`SELECT count(*)::int AS n, COALESCE(sum(total),0)::float AS dollars FROM invoices WHERE status IN ('open','partial') AND due_date IS NOT NULL AND due_date < $1::date`, [today]);
        return rows[0];
      });
      await safe('etransfersToReview', async () => (await query(`SELECT count(*)::int AS n FROM manager_payments WHERE resolved_at IS NULL AND status LIKE 'flag%'`)).rows[0].n);
      await safe('etransfersNobodyBacked', async () => { const { unbackedEtransfers } = await import('./manager-payments'); const r = await unbackedEtransfers(); return r.ok ? r.entries.length : 'could not check'; });
      await safe('moneyAtTheDoor', async () => { const { pendingCollectionQueue } = await import('./jobs'); const q = await pendingCollectionQueue(); return Array.isArray(q) ? q.length : (q?.count ?? 0); });
      await safe('looseEnds', async () => { const { staleStopCount } = await import('./jobs'); return await staleStopCount(); });
      return { date: today, ...out };
    }

    // ── acting at once ──
    case 'add_customer_note': {
      const { logActivity } = await import('./crm');
      const body = String(input.body || '').trim();
      if (!body) return { error: 'What should the note say?' };
      await logActivity({ customerId: Number(input.customer_id), kind: 'note', body, byEmail: BY_EMAIL, byName: BY });
      await said(dept, 'customer_note', `noted on customer ${input.customer_id}: ${body.slice(0, 80)}`, { customer: input.customer_id });
      return { ok: true, said: 'noted on their record' };
    }
    case 'complete_follow_up': {
      const { completeTask } = await import('./crm');
      await completeTask(Number(input.task_id), { by: BY, outcome: String(input.outcome || 'Done'), note: null });
      await said(dept, 'follow_up_done', `closed follow-up ${input.task_id}${input.outcome ? `: ${input.outcome}` : ''}`, { task: input.task_id });
      return { ok: true, said: 'that follow-up is done' };
    }
    case 'move_stop_day': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      if (!isDate(input.date)) return { error: 'Which date?' };
      const { assignJob } = await import('./jobs');
      await assignJob(j.id, { driverId: j.driver_id, driver2Id: j.driver2_id, jobDate: input.date }, BY);
      await said(dept, 'move_stop_day', `moved ${j.job_number} to ${input.date}`, { job: j.job_number, date: input.date });
      return { ok: true, said: `${j.job_number} is now on ${input.date}` };
    }
    case 'reopen_stop': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      const { reopenJob } = await import('./jobs');
      await reopenJob(j.id, BY);
      await said(dept, 'reopen_stop', `reopened ${j.job_number}`, { job: j.job_number });
      return { ok: true, said: `${j.job_number} is open again` };
    }
    case 'move_unit': {
      const skus = (input.skus || []).map((s) => String(s).trim()).filter(Boolean);
      if (!skus.length || !input.code) return { error: 'Which units, and to which spot?' };
      const { moveUnits } = await import('./locations');
      const r = await moveUnits({ skus, code: String(input.code).trim(), by: BY_EMAIL, byName: BY, via: 'manager' });
      await said(dept, 'move_unit', `moved ${skus.join(', ')} to ${input.code}`, { skus, code: input.code });
      return { ok: true, said: `${skus.length} unit${skus.length === 1 ? '' : 's'} recorded in ${input.code}`, detail: brief(r, 4) };
    }
    case 'post_team_message': {
      const { sendMessage } = await import('./team-board');
      const { rightsFor } = await import('./team-board-rules');
      const member = { key: 'manager', name: BY, groups: ['staff'], rights: rightsFor(['staff']) };
      const r = await sendMessage(member, { channel: input.channel, kind: input.title ? 'post' : 'chat', title: input.title, body: input.body });
      if (!r.ok) return { error: r.error || 'It did not post.' };
      await said(dept, 'team_post', `posted to the ${input.channel} board: ${String(input.body).slice(0, 80)}`, { channel: input.channel });
      return { ok: true, said: `posted to the ${input.channel} board` };
    }
    case 'set_quote_lost_reason': {
      const q = await quoteOf(input.number);
      if (!q) return { error: `I cannot find quote ${input.number}.` };
      const { setQuoteLostReason } = await import('./quotes');
      const r = await setQuoteLostReason(q.id, { reason: String(input.reason || ''), note: input.note || null, by: BY });
      if (r && r.error) return { error: r.error };
      await said(dept, 'quote_lost_reason', `recorded why ${q.number} was lost: ${input.reason}`, { quote: q.number });
      return { ok: true, said: `${q.number} is recorded as lost because ${input.reason}` };
    }
    case 'set_reorder_point': {
      const { setReorderPoint } = await import('./reorder');
      await setReorderPoint(Number(input.part_id), { point: num(input.point), qty: input.qty != null ? num(input.qty) : undefined });
      await said(dept, 'reorder_point', `set the reorder level for part ${input.part_id} to ${input.point}`, { part: input.part_id });
      return { ok: true, said: 'the reorder level is saved' };
    }
    case 'raise_cart_follow_ups': {
      const { raiseAbandonedCartTasks } = await import('./abandoned-carts');
      const r = await raiseAbandonedCartTasks({});
      await said(dept, 'cart_follow_ups', 'raised follow-ups for abandoned carts', { result: brief(r, 3) });
      return { ok: true, said: 'follow-ups are raised for the sales team', detail: brief(r, 3) };
    }
    case 'book_revisit': {
      const { bookRevisit } = await import('./jobs');
      const r = await bookRevisit(Number(input.ticket_id), BY);
      await said(dept, 'book_revisit', `booked a revisit on service call ${input.ticket_id}`, { ticket: input.ticket_id });
      return { ok: true, said: 'a revisit is booked and waiting to be assigned', detail: brief(r, 3) };
    }

    // ── proposed first, run after his yes ──
    case 'resend_invoice': {
      const inv = await invoiceOf(input.number);
      if (!inv) return { error: `I cannot find invoice ${input.number}.` };
      const { resendInvoice } = await import('./invoices');
      await resendInvoice(inv.id);
      await audited('invoice', inv.number, 'invoice.resend', `Manager re-sent ${inv.number} on the owner's instruction`, {});
      await said(dept, name, `re-sent ${inv.number} to the customer`, { number: inv.number });
      return { ok: true, said: `${inv.number} is on its way to the customer again` };
    }
    case 'convert_quote': {
      const q = await quoteOf(input.number);
      if (!q) return { error: `I cannot find quote ${input.number}.` };
      const { convertQuoteToInvoice } = await import('./quotes');
      const r = await convertQuoteToInvoice(q.id, BY_EMAIL);
      await audited('quote', q.number, 'quote.convert', `Manager turned ${q.number} into an invoice`, {});
      await said(dept, name, `turned quote ${q.number} into an invoice`, { quote: q.number });
      return { ok: true, said: `${q.number} is now an invoice${r?.untied ? `; ${r.untied} line${r.untied === 1 ? '' : 's'} are not tied to a unit` : ''}`, detail: brief(r, 3) };
    }
    case 'void_quote': {
      const q = await quoteOf(input.number);
      if (!q) return { error: `I cannot find quote ${input.number}.` };
      const { voidQuote } = await import('./quotes');
      await voidQuote(q.id, { reason: input.reason || null, by: BY });
      await said(dept, name, `closed quote ${q.number}`, { quote: q.number });
      return { ok: true, said: `${q.number} is closed` };
    }
    case 'set_coupon_active': {
      const { setCouponActive } = await import('./coupons');
      await setCouponActive(Number(input.coupon_id), !!input.active);
      await audited('coupon', String(input.coupon_id), 'coupon.active', `Manager turned coupon ${input.coupon_id} ${input.active ? 'on' : 'off'}`, {});
      await said(dept, name, `turned coupon ${input.coupon_id} ${input.active ? 'on' : 'off'}`, { coupon: input.coupon_id });
      return { ok: true, said: `that coupon is ${input.active ? 'on' : 'off'}` };
    }
    case 'decide_reseller': {
      const { setMembership } = await import('./members');
      await setMembership(Number(input.user_id), input.decision);
      await audited('member', String(input.user_id), `member.${input.decision}`, `Manager ${input.decision}d reseller ${input.user_id}`, {});
      await said(dept, name, `${input.decision === 'approve' ? 'approved' : 'rejected'} reseller application ${input.user_id}`, { user: input.user_id });
      return { ok: true, said: `the application is ${input.decision === 'approve' ? 'approved' : 'rejected'}` };
    }
    case 'cancel_stop': {
      const j = await jobOf(input.job_number);
      if (!j) return { error: `I cannot find a stop numbered ${input.job_number}.` };
      const { cancelJob } = await import('./jobs');
      await cancelJob(j.id, String(input.reason || 'Cancelled by the Manager on the owner\'s instruction'), BY);
      await said(dept, name, `cancelled ${j.job_number}: ${input.reason}`, { job: j.job_number });
      return { ok: true, said: `${j.job_number} is cancelled` };
    }
    case 'confirm_door_money': {
      const { confirmDoorCollection } = await import('./door-money');
      const r = await confirmDoorCollection(Number(input.collection_id), BY, input.amount != null ? { amount: num(input.amount) } : {});
      await audited('collection', String(input.collection_id), 'collection.confirm', `Manager confirmed door money ${input.collection_id}`, { amount: input.amount });
      await said(dept, name, `confirmed door money ${input.collection_id}${input.amount != null ? ` at ${moneyWords(num(input.amount))}` : ''}`, { id: input.collection_id });
      return { ok: true, said: 'that money is confirmed and the invoice is updated', detail: brief(r, 3) };
    }
    case 'reject_door_money': {
      const { rejectDoorCollection } = await import('./door-money');
      await rejectDoorCollection(Number(input.collection_id), BY, String(input.note || ''));
      await said(dept, name, `rejected door money ${input.collection_id}`, { id: input.collection_id });
      return { ok: true, said: 'that money is marked as not received, and the invoice stays owing' };
    }
    case 'approve_fill_requests': {
      const { approveFillRequests } = await import('./stock-reconcile');
      const ids = (input.ids || []).map(Number).filter(Boolean);
      const r = await approveFillRequests(ids, { by: BY });
      await said(dept, name, `approved ${ids.length} fill request${ids.length === 1 ? '' : 's'}`, { ids });
      return { ok: true, said: `${ids.length} fill request${ids.length === 1 ? '' : 's'} approved`, detail: brief(r, 4) };
    }
    case 'reject_fill_requests': {
      const { rejectFillRequests } = await import('./stock-reconcile');
      const ids = (input.ids || []).map(Number).filter(Boolean);
      const r = await rejectFillRequests(ids, { by: BY, note: input.note || null });
      await said(dept, name, `rejected ${ids.length} fill request${ids.length === 1 ? '' : 's'}`, { ids });
      return { ok: true, said: `${ids.length} rejected; those invoice lines are added as new units`, detail: brief(r, 4) };
    }
    case 'mark_supplier_bill_paid': {
      const { setPurchaseInvoicePaid } = await import('./finance');
      const date = isDate(input.date) ? input.date : torontoDay();
      await setPurchaseInvoicePaid(Number(input.purchase_invoice_id), date);
      await audited('purchase_invoice', String(input.purchase_invoice_id), 'purchase_invoice.paid', `Manager recorded supplier bill ${input.purchase_invoice_id} paid ${date}`, {});
      await said(dept, name, `recorded supplier bill ${input.purchase_invoice_id} as paid on ${date}`, { id: input.purchase_invoice_id });
      return { ok: true, said: `that supplier bill is recorded as paid on ${date}` };
    }
    case 'record_affiliate_payout': {
      const { recordPayout } = await import('./affiliates');
      const amount = num(input.amount);
      if (!(amount > 0)) return { error: 'How much was sent?' };
      const r = await recordPayout(Number(input.affiliate_id), { amount, ref: String(input.reference || ''), note: 'Recorded by the Manager on the owner\'s instruction' }, SESSION);
      if (r && r.error) return { error: r.error };
      await said(dept, name, `recorded a ${moneyWords(amount)} payout to affiliate ${input.affiliate_id}`, { affiliate: input.affiliate_id, amount });
      return { ok: true, said: `${moneyWords(amount)} is recorded as paid to that affiliate` };
    }

    // ── only on his instruction ──
    case 'issue_store_credit': {
      const amount = num(input.amount);
      if (!(amount > 0)) return { error: 'How much credit?' };
      const { issueStoreCredit } = await import('./store-credit');
      const r = await issueStoreCredit({ amount, invoiceNumber: input.invoice_number || null, name: input.name || null, email: input.email || null, by: BY });
      await audited('store_credit', String(r?.code || ''), 'store_credit.issue', `Manager issued ${moneyWords(amount)} store credit`, { amount });
      await said(dept, name, `issued ${moneyWords(amount)} of store credit`, { amount });
      return { ok: true, said: `${moneyWords(amount)} of store credit is issued`, code: r?.code };
    }
    case 'apply_store_credit': {
      const inv = await invoiceOf(input.number);
      if (!inv) return { error: `I cannot find invoice ${input.number}.` };
      const { applyStoreCreditToInvoice } = await import('./invoices');
      const r = await applyStoreCreditToInvoice(inv.id, String(input.code || ''), { amount: input.amount != null ? num(input.amount) : null, by: BY });
      await audited('invoice', inv.number, 'invoice.store_credit', `Manager used store credit on ${inv.number}`, { amount: input.amount });
      await said(dept, name, `used store credit on ${inv.number}`, { number: inv.number });
      return { ok: true, said: `the store credit is applied to ${inv.number}`, detail: brief(r, 3) };
    }
    default:
      return { error: 'Unknown tool.' };
  }
}

export function readBackB(name, i = {}) {
  const m = moneyWords;
  switch (name) {
    case 'resend_invoice': return `email invoice ${i.number} to the customer again`;
    case 'convert_quote': return `turn quote ${i.number} into an invoice`;
    case 'void_quote': return `close quote ${i.number}${i.reason ? ` because ${i.reason}` : ''}`;
    case 'set_coupon_active': return `turn coupon ${i.coupon_id} ${i.active ? 'on' : 'off'}`;
    case 'decide_reseller': return `${i.decision} reseller application ${i.user_id}`;
    case 'cancel_stop': return `cancel stop ${i.job_number} because ${i.reason}`;
    case 'confirm_door_money': return `confirm door collection ${i.collection_id}${i.amount != null ? ` at ${m(i.amount)}` : ''} and mark that invoice paid`;
    case 'reject_door_money': return `mark door collection ${i.collection_id} as never received`;
    case 'approve_fill_requests': return `approve ${(i.ids || []).length} fill request${(i.ids || []).length === 1 ? '' : 's'} and write their cost to the tracker`;
    case 'reject_fill_requests': return `reject ${(i.ids || []).length} fill request${(i.ids || []).length === 1 ? '' : 's'}`;
    case 'mark_supplier_bill_paid': return `record supplier bill ${i.purchase_invoice_id} as paid${i.date ? ` on ${i.date}` : ''}`;
    case 'record_affiliate_payout': return `record ${m(i.amount)} as already sent to affiliate ${i.affiliate_id}, reference ${i.reference}`;
    case 'issue_store_credit': return `issue ${m(i.amount)} of store credit${i.name ? ` to ${i.name}` : ''}`;
    case 'apply_store_credit': return `use store credit ${i.code} on ${i.number}${i.amount != null ? ` for ${m(i.amount)}` : ''}`;
    default: return name;
  }
}

// What a gated call moves, for the "over fifty dollars" read-back.
export function amountOfB(name, i = {}) {
  if (['issue_store_credit', 'apply_store_credit', 'record_affiliate_payout', 'confirm_door_money'].includes(name)) return Number(i.amount) || 0;
  return 0;
}

// The rules the Manager runs by, as data and pure functions. NO imports: the tests,
// the call route and the tools all read it, and so can a screen.
//
// THE MODEL (owner, 2026-11-17): the Manager acts like a general manager reporting
// to the CEO. It can do what an admin can do, EXCEPT where money is concerned:
//   · anything to do with PRICING or FINANCIALS is run past the owner first, on the
//     call, with a read-back and a "yes" on a LATER turn (lib/manager-call.js
//     enforces that in code, not in the prompt);
//   · refunds, discounts and voids happen ONLY on the owner's own instruction —
//     the Manager may suggest one, never start one;
//   · anything over OWNER_APPROVAL_OVER dollars is read back as a big one;
//   · a payment it can verify from the bank's own e-transfer email IS marked paid
//     by itself (amount exact, date sane, name matching); a name that differs is
//     reported, never silently accepted;
//   · it never moves money out of the bank, changes who has access, or deletes.
// Everything is logged and emailed; the day ends with a report.

export const OWNER_APPROVAL_OVER = 50;

// Who may ring in. A call from any other number is refused before the Manager says
// a word — an inbound line that answers anybody is a back door into the business.
export const CALLERS = [
  { name: 'Owner', number: '6476433035' },
  { name: 'Ravi', number: '6472449765' }
];

export const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const tail10 = (s) => digitsOf(s).slice(-10);
export function callerFor(from) {
  const t = tail10(from);
  if (t.length < 10) return null;
  return CALLERS.find((c) => c.number === t) || null;
}

// ── Departments ─────────────────────────────────────────────────────────────
// One Manager (gm) and two department managers who report to it. A department is
// a hat: its own opening, its own focus, and a SUBSET of the tools. The GM has all.
export const DEPTS = {
  gm: {
    label: 'General Manager', says: 'Bargain Bay and RS Solutions general manager',
    focus: 'the whole company: sales, deliveries, stock, money, the team. The Delivery and Sales managers report to you and you report to the owner.',
    tools: '*'
  },
  delivery: {
    label: 'Delivery Manager', says: 'RS Solutions delivery manager',
    focus: 'deliveries and service calls: who is on which stop, windows, run order, route and price from the rate sheet, failed or late stops, the vans, proof of delivery and client billing for runs.',
    tools: ['text_employee', 'late_stops', 'loose_ends', 'money_at_the_door', 'where_are_vans', 'move_stop_day', 'reopen_stop', 'cancel_stop', 'confirm_door_money', 'reject_door_money', 'book_revisit', 'move_unit', 'unit_location', 'post_team_message', 'morning_brief', 'follow_ups_due', 'complete_follow_up', 'business_snapshot', 'list_drivers', 'assign_stop', 'set_stop_window', 'reorder_run', 'set_stop_charge', 'set_stop_pay', 'price_stop',
      'stop_details', 'delivery_board', 'plan_run', 'pull_orders', 'stale_stops_preview', 'close_stale_stops', 'add_note', 'what_i_did', 'email_details', 'issue_details',
      'snooze_issue', 'switch_department', 'request_code_change', 'end_call']
  },
  sales: {
    label: 'Sales Manager', says: 'Bargain Bay sales manager',
    focus: 'selling: invoices and payments, quotes, pricing on units for retail and resellers, stock that is not moving, follow-ups with customers, the reseller list.',
    tools: ['pull_meta_leads', 'find_customer', 'find_quote', 'sales_report', 'abandoned_carts', 'reseller_applications', 'list_coupons', 'store_credit_balance', 'duplicate_customers', 'resend_invoice', 'convert_quote', 'void_quote', 'set_quote_lost_reason', 'set_coupon_active', 'decide_reseller', 'issue_store_credit', 'apply_store_credit', 'add_customer_note', 'complete_follow_up', 'follow_ups_due', 'raise_cart_follow_ups', 'unit_location', 'post_team_message', 'morning_brief', 'business_snapshot', 'find_invoice', 'find_unit', 'stale_stock', 'set_list_price', 'set_reseller_price', 'back_to_tracker_price', 'mark_invoice_paid',
      'record_payment', 'next_overdue_invoice', 'find_overdue_invoice', 'resolve_invoice', 'void_invoice', 'refund_invoice', 'apply_discount', 'payments_to_review', 'unbacked_payments', 'match_flagged_payment', 'scan_payments', 'add_followup',
      'edit_tracker_cell', 'edit_tracker_price_cell', 'set_tracker_status', 'add_note', 'what_i_did', 'email_details', 'issue_details', 'snooze_issue', 'switch_department', 'request_code_change', 'end_call']
  },
  tech: {
    label: 'Tech Manager', says: 'RS Solutions tech manager',
    focus: 'the tech and refurb department: who is clocked in and for how long, repair units with no parts marked, techs stuck on one unit too long, what is waiting for parts, and texting the techs to get things moving. Some of the team speak Tamil.',
    tools: ['text_employee', 'tech_status', 'list_drivers', 'unit_location', 'find_unit', 'move_unit', 'post_team_message', 'morning_brief', 'follow_ups_due', 'complete_follow_up', 'business_snapshot', 'add_note', 'what_i_did', 'email_details', 'issue_details',
      'snooze_issue', 'switch_department', 'request_code_change', 'end_call']
  },
};
// Books, buying and housekeeping: only the General Manager (and so only the owner's own
// line) holds these; the department managers do not.
export const GM_ONLY = ['payables', 'hst_position', 'stock_gaps', 'reorder_list', 'open_purchase_orders', 'fill_requests', 'approve_fill_requests',
  'reject_fill_requests', 'mark_supplier_bill_paid', 'record_affiliate_payout', 'affiliate_payout_run', 'set_reorder_point', 'health_check'];
export const deptKey = (d) => (DEPTS[d] ? d : 'gm');
export function toolsFor(dept, allTools = []) {
  const d = DEPTS[deptKey(dept)];
  if (d.tools === '*') return allTools;
  const keep = new Set(d.tools);
  return allTools.filter((t) => keep.has(t.name));
}

// ── Which tools need what ───────────────────────────────────────────────────
// act   : done now, reported after (internal, reversible, not money).
// gated : read back and run only on a LATER turn after his yes (money / pricing /
//         anything the owner said must be run by him).
// owner : gated, AND only ever on his instruction — the Manager may suggest it
//         but must not be the one to start it (refund, discount, void).
export const TOOL_TIER = {
  set_list_price: 'gated', set_reseller_price: 'gated', back_to_tracker_price: 'gated',
  set_stop_charge: 'gated', set_stop_pay: 'gated',
  mark_invoice_paid: 'gated', record_payment: 'gated', resolve_invoice: 'gated', match_flagged_payment: 'gated',
  edit_tracker_price_cell: 'gated', set_tracker_status: 'gated',
  void_invoice: 'owner', refund_invoice: 'owner', apply_discount: 'owner',
  issue_store_credit: 'owner', apply_store_credit: 'owner',
  resend_invoice: 'gated', convert_quote: 'gated', void_quote: 'gated', set_coupon_active: 'gated', decide_reseller: 'gated', cancel_stop: 'gated',
  confirm_door_money: 'gated', reject_door_money: 'gated', approve_fill_requests: 'gated', reject_fill_requests: 'gated',
  mark_supplier_bill_paid: 'gated', record_affiliate_payout: 'gated',
  set_photo_from_model: 'gated', run_inventory_sync: 'gated', close_stale_stops: 'gated', run_backup_now: 'gated'
};
export const tierOf = (name) => TOOL_TIER[name] || 'act';
export const isGated = (name) => tierOf(name) !== 'act';
export const isOwnerOnly = (name) => tierOf(name) === 'owner';

// Cells that change what something COSTS or SELLS FOR: gated. Everything else the
// Manager may fix on the tracker (notes, vendor, identity) it does at once.
export const TRACKER_PRICE_FIELDS = new Set(['retail', 'condition', 'price', 'cost', 'partsCost', 'totalCost']);
export const TRACKER_FREE_FIELDS = new Set(['notes', 'vendor', 'lot', 'category', 'description', 'make', 'model', 'serial']);

export const moneyWords = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-CA')}`;
export const overApproval = (amount) => Math.abs(Number(amount) || 0) > OWNER_APPROVAL_OVER;

// ── Stock that is not moving ────────────────────────────────────────────────
export const STALE_DAYS = 90;
const toDate = (s) => {
  const t = Date.parse(String(s || '').trim());
  return Number.isFinite(t) ? t : null;
};
export function ageDays(dateReceived, now = Date.now()) {
  const t = toDate(dateReceived);
  return t == null ? null : Math.floor((now - t) / 86400_000);
}
// A proposed drop for a unit that has sat for STALE_DAYS+. Proposes only when the
// margin is "quite high" (>= $150 and >= 20% of the price) — a thin unit has
// nowhere to go — and never below cost + 10%. Rounded to $10. The owner always
// answers with his own number; this is only the opening suggestion.
export function stalePricing({ price, cost, ageDays: age }) {
  const p = Number(price); const c = Number(cost);
  if (!(p > 0) || !(c > 0) || !(age >= STALE_DAYS)) return null;
  const margin = p - c;
  if (margin < 150 || margin < 0.2 * p) return null;
  const floor = Math.ceil((c * 1.1) / 10) * 10;
  const drop = Math.min(margin * 0.4, p * 0.25);
  const suggest = Math.max(floor, Math.round((p - drop) / 10) * 10);
  if (suggest >= p) return null;
  return { price: p, cost: c, margin: Math.round(margin), age, suggest, marginAfter: Math.round(suggest - c) };
}

// ── Matching an e-transfer to what it paid for ──────────────────────────────
const squash = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => squash(s).split(' ').filter((t) => t.length >= 3);
export function sameName(a, b) {
  const A = tokens(a); const B = new Set(tokens(b));
  if (!A.length || !B.size) return false;
  return A.some((t) => B.has(t));
}

// payment: { amountCents, name, at(ms) }   invoices: [{ number, balanceCents, customer, createdAt(ms) }]
// Returns { kind, invoice?, candidates? }:
//   exact         amount equals one open balance, date is after the invoice, name agrees
//   name_mismatch amount and date fit exactly one invoice but the name is different
//   date_mismatch the amount fits but the money arrived before the invoice existed
//   ambiguous     several invoices fit and the name does not pick one
//   none          nothing owes that amount
// It never picks between candidates on amount alone: many sales share a round figure.
// `recorded` is every payment a PERSON has already put on the ledger lately: [{ number, amountCents, atMs }].
// An e-transfer that was already applied by hand must never be applied again just because
// the invoice still owes the same amount (INV-1410, 2026-11-17: a $550 invoice, one $275
// deposit entered by staff, and the Manager read the same bank email and added a second
// $275, marking it paid). If a payment of this exact amount is already on the ledger within
// `recordedWindowMs` of the email, it is flagged for the owner, never applied.
export function matchPayment(payment, invoices = [], { graceMs = 36 * 3600_000, recorded = [], recordedWindowMs = 3 * 86400_000 } = {}) {
  const fits = invoices.filter((i) => i.balanceCents === payment.amountCents);
  if (!fits.length) return { kind: 'none' };
  const when = payment.at ?? Date.now();
  const already = recorded.filter((r) => r.amountCents === payment.amountCents && (r.atMs == null || Math.abs(r.atMs - when) <= recordedWindowMs));
  if (already.length) return { kind: 'already_recorded', candidates: fits, recorded: already };
  const dated = fits.filter((i) => payment.at == null || i.createdAt == null || payment.at >= i.createdAt - graceMs);
  if (!dated.length) return { kind: 'date_mismatch', candidates: fits };
  const named = dated.filter((i) => sameName(payment.name, i.customer));
  if (named.length === 1) return { kind: 'exact', invoice: named[0] };
  if (named.length > 1) return { kind: 'ambiguous', candidates: named };
  if (dated.length === 1) return { kind: 'name_mismatch', invoice: dated[0] };
  return { kind: 'ambiguous', candidates: dated };
}

// ── What a call-in is told, and the day's report ────────────────────────────
export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
export function dayReport({ actions = [], flagged = [], calls = 0, date = '' } = {}) {
  const byDept = {};
  for (const a of actions) {
    const d = deptKey(a.detail?.dept);
    (byDept[d] = byDept[d] || []).push(a);
  }
  const lines = [];
  for (const d of ['delivery', 'sales', 'tech', 'gm']) {
    if (!byDept[d]?.length) continue;
    lines.push({ dept: DEPTS[d].label, items: byDept[d].map((a) => a.summary) });
  }
  const head = actions.length
    ? `${plural(actions.length, 'thing')} done on ${date || 'the day'}${calls ? `, ${plural(calls, 'call')} with you` : ''}.`
    : `Nothing was done on ${date || 'the day'}${calls ? `, ${plural(calls, 'call')} with you` : ''}.`;
  return { head, sections: lines, needsYou: flagged };
}

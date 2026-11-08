// The business-development rep's Collected Sales and commission (Employment Agreement section 4,
// Addendum 1 section A). Everything is DERIVED from payments and refunds on every read — nothing
// that could be recomputed is stored — except an APPROVED weekly statement's snapshot, so a week
// the owner has signed off cannot move when something is corrected afterwards.
//
// What counts (the agreement's 4.4 and Addendum 1):
//   · COLLECTED SALES = a payment actually received, EXCLUDING HST, on the Toronto day it was
//     received. Parts and third-party costs are NOT deducted.
//   · An EMPLOYEE ACCOUNT — a customer the rep brought in (customers.owner_email) — counts on any
//     day, for life, for as long as the rep is employed.
//   · On an IN-HOUSE DAY (a shop clock-in that day) a deal the rep PERSONALLY closed that day also
//     counts, whoever owned the lead. "Closed" = the rep raised the invoice (invoices.created_by,
//     stamped from the session), and "that day" = the invoice was raised on the same Toronto day the
//     payment arrived. A balance paid weeks later on a Mobile Day for somebody else's customer
//     therefore does not count: that is the literal reading of 4.4(b), flagged for the owner.
//   · A LIQUIDATION PARTNER's sale counts only RS Solutions' own cut (the marketplace commission
//     ledger entry), for partners the rep sourced.
//   · REFUNDS reduce it. A refund lands on the Toronto day of the invoice's most recent payment on
//     or before it, and its effect on the commission (which is a cliff on the whole day) is booked
//     as a negative ADJUSTMENT in the week the refund happened — never by rewriting a past week.
import { hasDb, query } from './db';
import { torontoToday } from './constants';
import { getSetting, setSetting } from './settings';
import { audit } from './audit';
import { tieredCommission, nextTier, normalizeTiers } from './commission-tiers';

const TZ = "AT TIME ZONE 'America/Toronto'";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const norm = (e) => String(e || '').trim().toLowerCase();
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export class CommissionError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}

// ---- dates (plain YYYY-MM-DD strings; Toronto "today" comes from the server) ----
const toUtc = (d) => new Date(`${d}T12:00:00Z`);
const fmt = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = toUtc(d); x.setUTCDate(x.getUTCDate() + n); return fmt(x); };
export const weekStartOf = (d) => { const x = toUtc(d); const dow = (x.getUTCDay() + 6) % 7; return addDays(d, -dow); };
export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
/** Monday–Friday days from `from` to `to`, both counted. */
export function workingDaysBetween(from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const dow = (toUtc(d).getUTCDay() + 6) % 7; if (dow < 5) n++; }
  return n;
}

// ---- settings: the tier table, and each rep's plan -------------------------

export async function getTiers() { return normalizeTiers(await getSetting('rep_commission_tiers', null)); }
export async function setTiers(tiers, by) {
  const clean = normalizeTiers(tiers);
  await setSetting('rep_commission_tiers', clean);
  await audit({ email: by }, { action: 'sales.commission.tiers', entity: 'settings', summary: `Commission tiers set: ${clean.map((t) => `${t.inclusive ? '≥' : '>'}$${t.over} → ${t.pct}%`).join(', ')}` });
  return clean;
}

/** A rep on the tiered plan: { startDate, quota, quotaDays }. No plan, no commission. */
export async function getPlans() {
  const v = await getSetting('sales_rep_plans', {});
  return v && typeof v === 'object' ? v : {};
}
export async function repPlan(email) {
  const p = (await getPlans())[norm(email)];
  return p && DAY.test(p.startDate || '') ? { startDate: p.startDate, quota: Number(p.quota) || 0, quotaDays: Number(p.quotaDays) || 30, name: p.name || '' } : null;
}
export async function setRepPlan(email, plan, by) {
  const key = norm(email);
  if (!key.includes('@')) throw new CommissionError('Enter the rep’s email address.');
  const plans = await getPlans();
  if (plan === null) delete plans[key];
  else {
    if (!DAY.test(plan.startDate || '')) throw new CommissionError('Give the start date (YYYY-MM-DD).');
    const quota = Number(plan.quota); const days = Number(plan.quotaDays);
    plans[key] = { startDate: plan.startDate, quota: Number.isFinite(quota) && quota >= 0 ? quota : 0, quotaDays: Number.isFinite(days) && days > 0 ? Math.round(days) : 30, name: String(plan.name || '').slice(0, 100) };
  }
  await setSetting('sales_rep_plans', plans);
  await audit({ email: by }, { action: 'sales.commission.plan', entity: 'rep', summary: plan === null ? `Removed commission plan for ${key}` : `Commission plan for ${key}: starts ${plan.startDate}, quota $${plan.quota} in ${plan.quotaDays || 30} days` });
  return plans[key] || null;
}

// ---- shifts: In-house vs Mobile ---------------------------------------------

export async function openShift(email) {
  if (!hasDb()) return null;
  const { rows } = await query(`SELECT id, started_at FROM rep_shifts WHERE lower(rep_email) = $1 AND ended_at IS NULL`, [norm(email)]).catch(() => ({ rows: [] }));
  return rows[0] || null;
}
export async function clockIn(email) {
  if (!hasDb()) throw new CommissionError('Database not configured.', 'nodb');
  try {
    const { rows } = await query(`INSERT INTO rep_shifts (rep_email, place) VALUES ($1, 'shop') RETURNING id, started_at`, [norm(email)]);
    return rows[0];
  } catch (e) {
    if (/idx_rep_shifts_open|duplicate key/i.test(e.message)) throw new CommissionError('You are already clocked in at the shop.', 'open');
    throw e;
  }
}
export async function clockOut(email) {
  if (!hasDb()) throw new CommissionError('Database not configured.', 'nodb');
  const { rows } = await query(`UPDATE rep_shifts SET ended_at = now() WHERE lower(rep_email) = $1 AND ended_at IS NULL RETURNING id, started_at, ended_at`, [norm(email)]);
  if (!rows[0]) throw new CommissionError('You are not clocked in.', 'closed');
  return rows[0];
}
export async function recentShifts(email, limit = 30) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, started_at, ended_at, place, note, edited_by, (started_at ${TZ})::date::text AS day
       FROM rep_shifts WHERE lower(rep_email) = $1 ORDER BY started_at DESC LIMIT $2`, [norm(email), limit]).catch(() => ({ rows: [] }));
  return rows;
}
/** Owner edits a shift (a forgotten clock-in or clock-out). Logged. */
export async function fixShift(id, { startedAt, endedAt, note }, by) {
  if (!hasDb()) throw new CommissionError('Database not configured.', 'nodb');
  const s = startedAt ? new Date(startedAt) : null; const e = endedAt ? new Date(endedAt) : null;
  if ((startedAt && Number.isNaN(+s)) || (endedAt && Number.isNaN(+e))) throw new CommissionError('That time is not valid.');
  if (s && e && e < s) throw new CommissionError('The shift cannot end before it starts.');
  const { rows } = await query(
    `UPDATE rep_shifts SET started_at = COALESCE($2, started_at), ended_at = COALESCE($3, ended_at), note = COALESCE($4, note),
            edited_by = $5, edited_at = now() WHERE id = $1 RETURNING rep_email`, [Number(id), s, e, note || null, norm(by) || null]);
  if (!rows[0]) throw new CommissionError('Shift not found.', 'notfound');
  await audit({ email: by }, { action: 'sales.shift.fix', entity: 'rep_shifts', entityId: id, summary: `Shift ${id} for ${rows[0].rep_email} corrected` });
  return { ok: true };
}
export async function addShift(email, { startedAt, endedAt, note }, by) {
  if (!hasDb()) throw new CommissionError('Database not configured.', 'nodb');
  const s = new Date(startedAt); const e = endedAt ? new Date(endedAt) : null;
  if (Number.isNaN(+s) || (e && (Number.isNaN(+e) || e < s))) throw new CommissionError('Check the shift times.');
  const { rows } = await query(
    `INSERT INTO rep_shifts (rep_email, started_at, ended_at, note, edited_by, edited_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING id`,
    [norm(email), s, e, note || null, norm(by) || null]);
  await audit({ email: by }, { action: 'sales.shift.add', entity: 'rep_shifts', entityId: rows[0].id, summary: `Shop day added for ${norm(email)}` });
  return { id: rows[0].id };
}

// ---- ownership: whose account is it? ----------------------------------------

/** Admin sets (or clears) who brought a customer in. A reason is REQUIRED: it moves a rep's money. */
export async function setCustomerOwner(customerId, ownerEmail, reason, by) {
  if (!hasDb()) throw new CommissionError('Database not configured.', 'nodb');
  const why = String(reason || '').trim();
  if (why.length < 3) throw new CommissionError('Say why — this changes whose commission the account earns.', 'reason');
  const owner = norm(ownerEmail) || null;
  const { rows } = await query(
    `UPDATE customers SET owner_email = $2, owner_set_by = $3, owner_set_at = now(), owner_reason = $4 WHERE id = $1
     RETURNING id, email, name`, [Number(customerId), owner, norm(by) || null, why.slice(0, 300)]);
  if (!rows[0]) throw new CommissionError('Customer not found.', 'notfound');
  await audit({ email: by }, { action: 'sales.customer.owner', entity: 'customer', entityId: customerId, summary: `${rows[0].email || rows[0].name} → ${owner || 'nobody'}: ${why}` });
  return { ok: true };
}
export async function setVendorSourcedBy(vendorId, email, reason, by) {
  if (!hasDb()) throw new CommissionError('Database not configured.', 'nodb');
  const why = String(reason || '').trim();
  if (why.length < 3) throw new CommissionError('Say why.', 'reason');
  const { rowCount } = await query(`UPDATE vendors SET sourced_by_email = $2 WHERE id = $1`, [Number(vendorId), norm(email) || null]);
  if (!rowCount) throw new CommissionError('Partner not found.', 'notfound');
  await audit({ email: by }, { action: 'sales.vendor.sourced_by', entity: 'vendor', entityId: vendorId, summary: `Partner ${vendorId} sourced by ${norm(email) || 'nobody'}: ${why}` });
  return { ok: true };
}
export async function ownedAccounts(email) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, name, email, owner_set_at, owner_reason FROM customers WHERE lower(owner_email) = $1 ORDER BY owner_set_at DESC NULLS LAST, id DESC LIMIT 200`, [norm(email)]).catch(() => ({ rows: [] }));
  return rows;
}

// ---- the computation --------------------------------------------------------

/**
 * Everything the rep has collected from their plan's start date up to `upTo` (a Toronto date):
 * per-day nets with the rows behind them, and the refund adjustments. Derived every time.
 */
export async function history(email, upTo = torontoToday(), { plan: given } = {}) {
  const rep = norm(email);
  const empty = { rep, plan: null, tiers: normalizeTiers(null), days: [], adjustments: [], shopDays: [] };
  if (!hasDb()) return empty;
  const plan = given || await repPlan(rep);
  if (!plan) return empty;
  const tiers = await getTiers();
  const from = plan.startDate;

  const [shops, pays, refunds, liquid] = await Promise.all([
    query(`SELECT DISTINCT (started_at ${TZ})::date::text AS d FROM rep_shifts WHERE lower(rep_email) = $1`, [rep]).catch(() => ({ rows: [] })),
    query(
      `SELECT p.id, p.invoice_id, i.number, p.method, (p.paid_at ${TZ})::date::text AS day, p.paid_at, p.amount::float8 AS amount,
              CASE WHEN COALESCE(i.total,0) > 0 THEN COALESCE(i.subtotal, i.total)::float8 / i.total::float8 ELSE 1 END AS ratio,
              lower(i.created_by) AS created_by, (i.created_at ${TZ})::date::text AS created_day, i.email AS invoice_email,
              (SELECT lower(c.owner_email) FROM customers c
                WHERE lower(c.email) = lower(i.email)
                   OR EXISTS (SELECT 1 FROM customer_aliases a WHERE a.customer_id = c.id AND a.kind = 'email' AND a.value = lower(i.email))
                ORDER BY (c.owner_email IS NULL), c.id LIMIT 1) AS owner
         FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.status <> 'void' AND (p.paid_at ${TZ})::date >= $1::date AND (p.paid_at ${TZ})::date <= $2::date
        ORDER BY p.paid_at, p.id`, [from, upTo]),
    query(
      `SELECT r.id, r.invoice_id, r.amount::float8 AS amount, r.created_at, (r.created_at ${TZ})::date::text AS day, i.number
         FROM invoice_refunds r JOIN invoices i ON i.id = r.invoice_id
        WHERE (r.created_at ${TZ})::date >= $1::date AND (r.created_at ${TZ})::date <= $2::date ORDER BY r.created_at, r.id`, [from, upTo]),
    query(
      `SELECT (l.at ${TZ})::date::text AS day, (-l.amount_cents)::float8 / 100 AS cut, l.order_ref, v.trade_name, v.legal_name
         FROM vendor_ledger l JOIN vendors v ON v.id = l.vendor_id
        WHERE l.kind = 'commission' AND lower(v.sourced_by_email) = $1
          AND (l.at ${TZ})::date >= $2::date AND (l.at ${TZ})::date <= $3::date`, [rep, from, upTo]).catch(() => ({ rows: [] }))
  ]);

  const shopDays = new Set(shops.rows.map((r) => r.d));
  const byDay = new Map();
  const bucket = (d) => { if (!byDay.has(d)) byDay.set(d, { day: d, net: 0, rows: [] }); return byDay.get(d); };

  const eligible = new Map();   // payment id -> { day, net }
  for (const p of pays.rows) {
    const owned = p.owner === rep;
    const inhouse = shopDays.has(p.day) && p.created_by === rep && p.created_day === p.day;
    const basis = owned ? 'account' : inhouse ? 'in-house close' : null;
    const net = r2(p.amount * p.ratio);
    if (!basis) continue;
    const b = bucket(p.day);
    b.net = r2(b.net + net);
    b.rows.push({ kind: 'payment', ref: p.number, basis, amount: r2(p.amount), net, method: p.method });
    eligible.set(p.id, { day: p.day, net, invoiceId: p.invoice_id, ratio: p.ratio, paidAt: p.paid_at });
  }
  for (const l of liquid.rows) {
    const net = r2(l.cut);
    const b = bucket(l.day);
    b.net = r2(b.net + net);
    b.rows.push({ kind: 'liquidation', ref: l.order_ref || '', basis: `partner cut — ${l.trade_name || l.legal_name}`, amount: net, net });
  }

  // Refunds: onto the day of the invoice's latest eligible payment at or before the refund; the change
  // in that day's commission is the adjustment, booked on the refund's own date.
  const running = new Map([...byDay.entries()].map(([d, b]) => [d, b.net]));
  const adjustments = [];
  for (const rf of refunds.rows) {
    const mine = [...eligible.values()].filter((e) => e.invoiceId === rf.invoice_id && new Date(e.paidAt) <= new Date(rf.created_at));
    const target = mine.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0];
    if (!target) continue;
    const before = running.get(target.day) ?? 0;
    const cut = r2(Math.min(rf.amount * target.ratio, Math.max(before, 0)));
    const after = r2(before - cut);
    running.set(target.day, after);
    const delta = r2(tieredCommission(after, tiers).commission - tieredCommission(before, tiers).commission);
    adjustments.push({ at: rf.day, invoice: rf.number, forDay: target.day, refundedNet: cut, amount: delta });
  }

  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map((b) => {
    const t = tieredCommission(b.net, tiers);
    return { ...b, pct: t.pct, commission: t.commission, mode: shopDays.has(b.day) ? 'in-house' : 'mobile', netAfterRefunds: r2(running.get(b.day) ?? b.net) };
  });
  return { rep, plan, tiers, days, adjustments, shopDays: [...shopDays].sort() };
}

/** One Monday-to-Sunday week, computed live: each day, its adjustments, and the total owed. */
export function weekOf(hist, weekStart) {
  const end = addDays(weekStart, 6);
  const days = weekDays(weekStart).map((d) => {
    const row = hist.days.find((x) => x.day === d);
    return row ? { ...row } : { day: d, net: 0, rows: [], pct: 0, commission: 0, mode: hist.shopDays.includes(d) ? 'in-house' : 'mobile', netAfterRefunds: 0 };
  });
  const adjustments = hist.adjustments.filter((a) => a.at >= weekStart && a.at <= end);
  const commission = r2(days.reduce((a, d) => a + d.commission, 0));
  const adj = r2(adjustments.reduce((a, x) => a + x.amount, 0));
  return { rep: hist.rep, weekStart, weekEnd: end, days, adjustments, commission, adjustmentsTotal: adj, total: r2(commission + adj), collected: r2(days.reduce((a, d) => a + d.net, 0)) };
}

export async function storedStatement(email, weekStart) {
  if (!hasDb()) return null;
  const { rows } = await query(
    `SELECT id, rep_email, period_start::text AS period_start, period_end::text AS period_end, status, total::float8 AS total, snapshot, approved_by, approved_at, paid_by, paid_at
       FROM commission_statements WHERE lower(rep_email) = $1 AND period_start = $2::date`, [norm(email), weekStart]).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

/** The statement for a week: the approved snapshot if there is one (with any drift from live), else a live draft. */
export async function statementFor(email, weekStart) {
  const start = weekStartOf(DAY.test(weekStart || '') ? weekStart : torontoToday());
  const hist = await history(email, addDays(start, 6));
  const live = weekOf(hist, start);
  const stored = await storedStatement(email, start);
  if (!stored) return { ...live, status: 'draft', plan: hist.plan, tiers: hist.tiers };
  return {
    ...stored.snapshot, status: stored.status, approvedBy: stored.approved_by, approvedAt: stored.approved_at, paidAt: stored.paid_at,
    plan: hist.plan, tiers: hist.tiers, drift: r2(live.total - stored.total)
  };
}

export async function approveStatement(email, weekStart, by) {
  const start = weekStartOf(weekStart);
  if (addDays(start, 6) >= torontoToday()) throw new CommissionError('That week is not over yet. Approve it once Sunday has ended.', 'open-week');
  if (await storedStatement(email, start)) throw new CommissionError('That week is already approved.', 'exists');
  const hist = await history(email, addDays(start, 6));
  if (!hist.plan) throw new CommissionError('That person has no commission plan.', 'noplan');
  const live = weekOf(hist, start);
  await query(
    `INSERT INTO commission_statements (rep_email, period_start, period_end, total, snapshot, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [norm(email), start, addDays(start, 6), live.total, JSON.stringify(live), norm(by) || null]);
  await audit({ email: by }, { action: 'sales.commission.approve', entity: 'statement', entityId: `${norm(email)}:${start}`, summary: `Approved ${norm(email)} week of ${start}: $${live.total.toFixed(2)}` });
  return { ...live, status: 'approved' };
}
export async function markStatementPaid(email, weekStart, by) {
  const start = weekStartOf(weekStart);
  const { rowCount } = await query(
    `UPDATE commission_statements SET status = 'paid', paid_by = $3, paid_at = now() WHERE lower(rep_email) = $1 AND period_start = $2::date AND status = 'approved'`,
    [norm(email), start, norm(by) || null]);
  if (!rowCount) throw new CommissionError('That week is not approved, or is already paid.', 'state');
  await audit({ email: by }, { action: 'sales.commission.paid', entity: 'statement', entityId: `${norm(email)}:${start}`, summary: `Marked ${norm(email)} week of ${start} paid` });
  return { ok: true };
}
export async function listStatements(email) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT period_start::text AS week, status, total::float8 AS total, approved_at, paid_at FROM commission_statements WHERE lower(rep_email) = $1 ORDER BY period_start DESC LIMIT 60`, [norm(email)]).catch(() => ({ rows: [] }));
  return rows;
}

/** The weekly statement as CSV, cells neutralised against spreadsheet formulas. */
export function statementCsv(s) {
  const cell = (v) => { const t = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const lines = [['Rep', s.rep], ['Week', `${s.weekStart} to ${s.weekEnd}`], ['Status', s.status], [], ['Date', 'Day type', 'Collected sales (ex HST)', 'Rate %', 'Commission']];
  for (const d of s.days) lines.push([d.day, d.mode, d.net.toFixed(2), d.pct, d.commission.toFixed(2)]);
  lines.push([], ['Adjustment (refund)', 'Invoice', 'For day', '', 'Amount']);
  for (const a of s.adjustments) lines.push([a.at, a.invoice, a.forDay, '', a.amount.toFixed(2)]);
  lines.push([], ['Commission', '', '', '', s.commission.toFixed(2)], ['Adjustments', '', '', '', s.adjustmentsTotal.toFixed(2)], ['Total', '', '', '', s.total.toFixed(2)]);
  return lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
}

/** What the rep sees on Home: today so far, the next tier, and progress against the quota window. */
export async function repToday(email, today = torontoToday()) {
  const hist = await history(email, today);
  if (!hist.plan) return null;
  const { plan, tiers } = hist;
  const todayRow = hist.days.find((d) => d.day === today);
  const net = todayRow ? todayRow.net : 0;
  const t = tieredCommission(net, tiers);
  const windowEnd = addDays(plan.startDate, plan.quotaDays - 1);
  const inWin = hist.days.filter((d) => d.day >= plan.startDate && d.day <= windowEnd);
  const adjNet = hist.adjustments.filter((a) => a.forDay >= plan.startDate && a.forDay <= windowEnd).reduce((a, x) => a + x.refundedNet, 0);
  const collected = r2(inWin.reduce((a, d) => a + d.net, 0) - adjNet);
  const left = Math.max(0, r2(plan.quota - collected));
  const daysLeft = today > windowEnd ? 0 : workingDaysBetween(today > plan.startDate ? today : plan.startDate, windowEnd);
  return {
    today, mode: hist.shopDays.includes(today) ? 'in-house' : 'mobile',
    todayNet: net, todayPct: t.pct, todayCommission: t.commission, next: nextTier(net, tiers),
    quota: { target: plan.quota, collected, left, windowStart: plan.startDate, windowEnd, workingDaysLeft: daysLeft, perDayNeeded: daysLeft ? r2(left / daysLeft) : left, over: today > windowEnd }
  };
}

/** Owner's day-30 report: collected sales in the plan's window against the quota, and the lead activity. */
export async function dayReport(email) {
  const plan = await repPlan(email);
  if (!plan) return null;
  const windowEnd = addDays(plan.startDate, plan.quotaDays - 1);
  const upTo = windowEnd < torontoToday() ? windowEnd : torontoToday();
  const hist = await history(email, upTo, { plan });
  const gross = r2(hist.days.reduce((a, d) => a + d.net, 0));
  const refunded = r2(hist.adjustments.reduce((a, x) => a + x.refundedNet, 0));
  const collected = r2(gross - refunded);
  const { rows: act } = hasDb() ? await query(
    `SELECT count(*) FILTER (WHERE kind IN ('call','email','whatsapp','text','meeting','site_visit','walk_in','linkedin'))::int AS touches,
            count(*) FILTER (WHERE outcome = 'conversation')::int AS conversations,
            count(*) FILTER (WHERE outcome = 'meeting_booked')::int AS meetings,
            count(*) FILTER (WHERE outcome = 'proposal_sent')::int AS proposals
       FROM lead_activities WHERE lower(by_email) = $1 AND (occurred_at ${TZ})::date BETWEEN $2::date AND $3::date`, [norm(email), plan.startDate, upTo]).catch(() => ({ rows: [{}] })) : { rows: [{}] };
  const { rows: pipe } = hasDb() ? await query(
    `SELECT count(*)::int AS open, COALESCE(sum(est_value),0)::float8 AS value FROM leads WHERE lower(owner_email) = $1 AND stage IN ('new','contacted','conversation','meeting','proposal')`, [norm(email)]).catch(() => ({ rows: [{}] })) : { rows: [{}] };
  const commission = r2(hist.days.reduce((a, d) => a + d.commission, 0) + hist.adjustments.reduce((a, x) => a + x.amount, 0));
  return {
    rep: norm(email), windowStart: plan.startDate, windowEnd, asOf: upTo, finished: windowEnd < torontoToday(),
    quota: plan.quota, collected, gross, refunded, percent: plan.quota ? Math.round((collected / plan.quota) * 1000) / 10 : null,
    met: plan.quota > 0 && collected >= plan.quota, commission,
    activity: act[0] || {}, pipeline: pipe[0] || {}
  };
}

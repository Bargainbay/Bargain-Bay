// Payroll / labor tracking. The team self-reports work to the bot on Telegram
// (HR agent logs it); drivers' pay is derived automatically from delivery data we
// already track. Weekly (Mon–Sun, America/Toronto). Mix model: shop techs by
// piece-rate (test/clean/repair), drivers per delivery, optional hourly.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';
import { hoursReport, weekRange } from './hours';

const SALE = "('confirmed','ready','out_for_delivery','delivered')";
const n = (v) => Number(v || 0);

let ensured = null;
async function ensure() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = query(`CREATE TABLE IF NOT EXISTS labor_log (
    id serial PRIMARY KEY,
    worker text NOT NULL,
    work_date date NOT NULL,
    tested int DEFAULT 0,
    cleaned int DEFAULT 0,
    repaired int DEFAULT 0,
    hours numeric(6,2) DEFAULT 0,
    note text,
    source text,
    created_at timestamptz DEFAULT now()
  )`).catch((e) => { ensured = null; throw e; });
  return ensured;
}

// Default piece rates mirror the tracker's Settings tab ($50 test / $25 clean /
// $50 repair). Delivery + hourly default to 0 until the owner sets them.
const DEFAULT_RATES = { test: 50, clean: 25, repair: 50, delivery: 0, hourly: 0 };

export async function getRates() {
  const r = await getSetting('payroll_rates', null);
  return { ...DEFAULT_RATES, ...(r || {}), perWorkerHourly: (r && r.perWorkerHourly) || {} };
}
export async function setRates(rates = {}) {
  const clean = {
    test: n(rates.test), clean: n(rates.clean), repair: n(rates.repair),
    delivery: n(rates.delivery), hourly: n(rates.hourly),
    perWorkerHourly: rates.perWorkerHourly && typeof rates.perWorkerHourly === 'object' ? rates.perWorkerHourly : {}
  };
  await setSetting('payroll_rates', clean);
  return clean;
}

// Log a worker's reported work. tested/cleaned/repaired are unit counts; hours is
// optional clock time. date defaults to today (store-local).
export async function logLabor({ worker, date, tested, cleaned, repaired, hours, note, source = 'telegram' }) {
  if (!hasDb()) throw new Error('Database not configured.');
  const who = String(worker || '').trim();
  if (!who) throw new Error('Who is this for? Include the worker’s name.');
  await ensure();
  const d = date || new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `INSERT INTO labor_log (worker, work_date, tested, cleaned, repaired, hours, note, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [who, d, n(tested), n(cleaned), n(repaired), n(hours), note || null, source]
  );
  return { id: rows[0].id, worker: who, date: d };
}

export async function recentLabor(limit = 20) {
  if (!hasDb()) return [];
  await ensure();
  const { rows } = await query('SELECT id, worker, work_date, tested, cleaned, repaired, hours, note, source FROM labor_log ORDER BY work_date DESC, id DESC LIMIT $1', [limit]);
  return rows.map((r) => ({ id: r.id, worker: r.worker, date: r.work_date ? new Date(r.work_date).toISOString().slice(0, 10) : null, tested: n(r.tested), cleaned: n(r.cleaned), repaired: n(r.repaired), hours: n(r.hours), note: r.note, source: r.source }));
}

export async function deleteLabor(id) {
  await ensure();
  await query('DELETE FROM labor_log WHERE id = $1', [id]);
  return true;
}

// Labor cost inside an arbitrary window — powers the Financial dashboard's Labor
// line so net profit includes what the crew earned. startSql/endSql are TRUSTED
// SQL fragments from lib/analytics' allowlisted period windows (never user text),
// evaluating to Toronto-local timestamps. Same rate math as payrollReport.
export async function laborCostBetween(startSql, endSql) {
  if (!hasDb()) return { total: 0, workers: 0 };
  await ensure();
  const rates = await getRates();
  const inWin = (expr) => `${expr} >= (${startSql}) AND ${expr} < (${endSql})`;

  const labor = (await query(`
    SELECT worker, COALESCE(SUM(tested),0) tested, COALESCE(SUM(cleaned),0) cleaned,
           COALESCE(SUM(repaired),0) repaired, COALESCE(SUM(hours),0) hours
      FROM labor_log WHERE ${inWin('work_date')} GROUP BY worker`).catch(() => ({ rows: [] }))).rows;

  // A Bargain Bay delivery can now be paid in two places: this flat rate per
  // delivered order, and dispatch's per-job `pay_amount` (what that stop cost
  // us, set at close-out). Same run, two ledgers.
  //
  // The rule: an EXPLICIT dispatch amount wins, and only then. A job priced in
  // dispatch is skipped here; an unpriced one still earns the flat rate, so the
  // fix can never silently leave a driver unpaid — which is the failure mode
  // that would matter far more than counting a delivery twice.
  let drivers = [];
  try {
    drivers = (await query(`
      SELECT COALESCE(NULLIF(u.name,''), u.email) AS worker, COUNT(*) AS deliveries
        FROM orders o JOIN users u ON u.id = o.driver_id
       WHERE o.status='delivered' AND o.delivered_at IS NOT NULL
         AND ${inWin("(o.delivered_at AT TIME ZONE 'America/Toronto')")}
         AND NOT EXISTS (SELECT 1 FROM jobs j
                          WHERE j.order_id = o.id AND j.status <> 'cancelled'
                            AND j.pay_amount IS NOT NULL)
       GROUP BY 1`)).rows;
  } catch { drivers = []; }

  const byWorker = new Map();
  const get = (w) => { if (!byWorker.has(w)) byWorker.set(w, { tested: 0, cleaned: 0, repaired: 0, hours: 0, deliveries: 0 }); return byWorker.get(w); };
  for (const r of labor) { const e = get(r.worker); e.tested = n(r.tested); e.cleaned = n(r.cleaned); e.repaired = n(r.repaired); e.hours = n(r.hours); }
  for (const r of drivers) { get(r.worker).deliveries += n(r.deliveries); }

  let total = 0;
  for (const [worker, e] of byWorker) {
    const hourly = n(rates.perWorkerHourly[worker]) || n(rates.hourly);
    total += e.tested * n(rates.test) + e.cleaned * n(rates.clean) + e.repaired * n(rates.repair)
      + e.deliveries * n(rates.delivery) + e.hours * hourly;
  }
  return { total, workers: byWorker.size };
}

// Weekly payroll (Mon–Sun). weekOffset: 0 = this week, -1 = last week.
export async function payrollReport({ weekOffset = 0, from = null, to = null } = {}) {
  if (!hasDb()) return null;
  await ensure();
  const rates = await getRates();
  // Week boundary in store-local time; date_trunc('week') is Monday-based.
  const wk = `(date_trunc('week', (now() AT TIME ZONE 'America/Toronto')::date) + (${Number(weekOffset) || 0} * interval '1 week'))`;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const custom = ISO.test(from || '') && ISO.test(to || '');
  const inWeek = custom
    ? (col) => `${col} >= '${from}'::date AND ${col} <= '${to}'::date`
    : (col) => `${col} >= ${wk}::date AND ${col} < (${wk}::date + interval '7 days')`;

  // Self-reported shop labor, grouped by worker.
  const labor = (await query(`
    SELECT worker, COALESCE(SUM(tested),0) tested, COALESCE(SUM(cleaned),0) cleaned,
           COALESCE(SUM(repaired),0) repaired, COALESCE(SUM(hours),0) hours
      FROM labor_log WHERE ${inWeek('work_date')} GROUP BY worker`)).rows;

  // Driver deliveries (auto) for the same week — minus anything dispatch has
  // already put a price on. See the note above: explicit dispatch pay wins,
  // everything else still earns the flat rate here.
  let drivers = [];
  let onDispatch = [];
  try {
    drivers = (await query(`
      SELECT COALESCE(NULLIF(u.name,''), u.email) AS worker, COUNT(*) AS deliveries
        FROM orders o JOIN users u ON u.id = o.driver_id
       WHERE o.status='delivered' AND o.delivered_at IS NOT NULL
         AND ${inWeek('(o.delivered_at AT TIME ZONE \'America/Toronto\')::date')}
         AND NOT EXISTS (SELECT 1 FROM jobs j
                          WHERE j.order_id = o.id AND j.status <> 'cancelled'
                            AND j.pay_amount IS NOT NULL)
       GROUP BY 1`)).rows;
    // What was left out, so a short number is never a mystery.
    onDispatch = (await query(`
      SELECT COALESCE(NULLIF(u.name,''), u.email) AS worker, COUNT(*) AS deliveries,
             COALESCE(SUM(j.pay_amount),0) AS paid
        FROM orders o
        JOIN users u ON u.id = o.driver_id
        JOIN jobs  j ON j.order_id = o.id AND j.status <> 'cancelled' AND j.pay_amount IS NOT NULL
       WHERE o.status='delivered' AND o.delivered_at IS NOT NULL
         AND ${inWeek('(o.delivered_at AT TIME ZONE \'America/Toronto\')::date')}
       GROUP BY 1`)).rows;
  } catch { drivers = []; onDispatch = []; }

  const byWorker = new Map();
  const get = (w) => { if (!byWorker.has(w)) byWorker.set(w, { worker: w, tested: 0, cleaned: 0, repaired: 0, hours: 0, deliveries: 0, amount: 0, dispatchDeliveries: 0, dispatchPaid: 0, clockHours: 0, clockPay: 0, clockSources: [] }); return byWorker.get(w); };
  for (const r of labor) {
    const e = get(r.worker);
    e.tested = n(r.tested); e.cleaned = n(r.cleaned); e.repaired = n(r.repaired); e.hours = n(r.hours);
  }
  for (const r of drivers) { get(r.worker).deliveries += n(r.deliveries); }
  // Carried, not counted: these are paid on the dispatch Pay tab. Shown so a
  // driver's short delivery count has a visible reason next to it.
  for (const r of onDispatch) {
    const e = get(r.worker);
    e.dispatchDeliveries = n(r.deliveries);
    e.dispatchPaid = n(r.paid);
  }

  // Clock hours: the staff clock and the driver shifts (lib/hours.js, the same
  // rows the Hours page and the Daily P&L read). Paid at the rate on the shift
  // (staff: snapshotted at clock-in; driver: their hourly rate); an owner's
  // hours are listed and cost nothing. A person already in the table by name
  // (Telegram labour, deliveries) is matched case-insensitively so they stay one line.
  let clockWarnings = [];
  try {
    const hr = await hoursReport(custom ? { from, to } : weekRange(weekOffset));
    clockWarnings = hr.warnings;
    const keyOf = (name) => [...byWorker.keys()].find((k) => k.trim().toLowerCase() === String(name).trim().toLowerCase());
    for (const p of hr.people) {
      if (!p.hours && !p.cost) continue;
      const e = get(keyOf(p.person) || p.person);
      e.clockHours = p.hours; e.clockPay = p.cost; e.clockSources = p.sources;
    }
  } catch { clockWarnings = ['Clock hours could not be read, so they are NOT in these totals.']; }

  for (const e of byWorker.values()) {
    const hourly = n(rates.perWorkerHourly[e.worker]) || n(rates.hourly);
    e.amount = e.tested * n(rates.test) + e.cleaned * n(rates.clean) + e.repaired * n(rates.repair)
      + e.deliveries * n(rates.delivery) + e.hours * hourly + e.clockPay;
    // Hourly pay from the clock AND per-stop pay on dispatch for the same
    // person is the one way a driver can be paid twice for the same day.
    e.doublePay = e.clockPay > 0 && e.dispatchPaid > 0;
    // Telegram-reported hours AND clock hours: the same hours reported twice.
    e.doubleHours = e.clockHours > 0 && e.hours > 0 && hourly > 0;
  }
  const workers = [...byWorker.values()].sort((a, b) => b.amount - a.amount);
  const total = workers.reduce((s, w) => s + w.amount, 0);
  return { weekOffset: Number(weekOffset) || 0, rates, workers, total, ...(custom ? { from, to } : weekRange(weekOffset)), clockWarnings };
}


// ---- Paid ledger -----------------------------------------------------------
// Pay owed is worked out from hours and work; nothing used to record that
// somebody was PAID. Owed = earned since PAY_START less everything paid out.
// Amounts are append-only (a mistake is voided, never edited).
export const PAY_START = '2026-08-01';

let ensuredPay = null;
async function ensurePay() {
  if (!hasDb()) return;
  if (ensuredPay) return ensuredPay;
  ensuredPay = query(`CREATE TABLE IF NOT EXISTS payroll_payments (
    id serial PRIMARY KEY,
    worker text NOT NULL,
    amount numeric(10,2) NOT NULL,
    paid_on date NOT NULL DEFAULT CURRENT_DATE,
    note text,
    created_by text,
    created_at timestamptz DEFAULT now(),
    voided_at timestamptz
  )`).catch((e) => { ensuredPay = null; throw e; });
  return ensuredPay;
}

const key = (w) => String(w || '').trim().toLowerCase();

export async function payrollBalances() {
  if (!hasDb()) return null;
  await ensurePay();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const rep = await payrollReport({ from: PAY_START, to: today });
  const pays = (await query(`SELECT id, worker, amount, paid_on, note FROM payroll_payments WHERE voided_at IS NULL ORDER BY paid_on DESC, id DESC`)).rows;
  const map = new Map();
  const get = (w) => { const k = key(w); if (!map.has(k)) map.set(k, { worker: w, earned: 0, hours: 0, paid: 0, payments: [] }); return map.get(k); };
  for (const w of rep?.workers || []) { const e = get(w.worker); e.earned += n(w.amount); e.hours += n(w.clockHours) + n(w.hours); }
  for (const p of pays) { const e = get(p.worker); e.paid += n(p.amount); e.payments.push({ id: p.id, amount: n(p.amount), paidOn: String(p.paid_on).slice(0, 10), note: p.note }); }
  const people = [...map.values()].map((e) => ({ ...e, owed: Math.round((e.earned - e.paid) * 100) / 100 })).sort((a, b) => b.owed - a.owed);
  return { from: PAY_START, to: today, people, warnings: rep?.clockWarnings || [] };
}

export async function recordPayment({ worker, amount, paidOn, note, by }) {
  await ensurePay();
  const a = Number(amount);
  if (!String(worker || '').trim()) throw new Error('Worker is required.');
  if (!Number.isFinite(a) || a === 0) throw new Error('Enter an amount.');
  const r = await query(`INSERT INTO payroll_payments (worker, amount, paid_on, note, created_by) VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5) RETURNING id`,
    [String(worker).trim(), Math.round(a * 100) / 100, /^\d{4}-\d{2}-\d{2}$/.test(paidOn || '') ? paidOn : null, note || null, by || null]);
  return r.rows[0].id;
}

// Pays whatever is currently owed to this person (the "cleared" button).
export async function clearOwed({ worker, note, by }) {
  const b = await payrollBalances();
  const p = b.people.find((x) => key(x.worker) === key(worker));
  if (!p || p.owed <= 0) return { id: null, amount: 0 };
  const id = await recordPayment({ worker: p.worker, amount: p.owed, note: note || 'Cleared', by });
  return { id, amount: p.owed };
}

export async function voidPayment(id) {
  await ensurePay();
  await query(`UPDATE payroll_payments SET voided_at = now() WHERE id = $1`, [Number(id)]);
}

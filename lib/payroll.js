// Payroll / labor tracking. The team self-reports work to the bot on Telegram
// (HR agent logs it); drivers' pay is derived automatically from delivery data we
// already track. Weekly (Mon–Sun, America/Toronto). Mix model: shop techs by
// piece-rate (test/clean/repair), drivers per delivery, optional hourly.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';

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

// Weekly payroll (Mon–Sun). weekOffset: 0 = this week, -1 = last week.
export async function payrollReport({ weekOffset = 0 } = {}) {
  if (!hasDb()) return null;
  await ensure();
  const rates = await getRates();
  // Week boundary in store-local time; date_trunc('week') is Monday-based.
  const wk = `(date_trunc('week', (now() AT TIME ZONE 'America/Toronto')::date) + (${Number(weekOffset) || 0} * interval '1 week'))`;
  const inWeek = (col) => `${col} >= ${wk}::date AND ${col} < (${wk}::date + interval '7 days')`;

  // Self-reported shop labor, grouped by worker.
  const labor = (await query(`
    SELECT worker, COALESCE(SUM(tested),0) tested, COALESCE(SUM(cleaned),0) cleaned,
           COALESCE(SUM(repaired),0) repaired, COALESCE(SUM(hours),0) hours
      FROM labor_log WHERE ${inWeek('work_date')} GROUP BY worker`)).rows;

  // Driver deliveries (auto) for the same week.
  let drivers = [];
  try {
    drivers = (await query(`
      SELECT COALESCE(NULLIF(u.name,''), u.email) AS worker, COUNT(*) AS deliveries
        FROM orders o JOIN users u ON u.id = o.driver_id
       WHERE o.status='delivered' AND o.delivered_at IS NOT NULL
         AND ${inWeek('(o.delivered_at AT TIME ZONE \'America/Toronto\')::date')}
       GROUP BY 1`)).rows;
  } catch { drivers = []; }

  const byWorker = new Map();
  const get = (w) => { if (!byWorker.has(w)) byWorker.set(w, { worker: w, tested: 0, cleaned: 0, repaired: 0, hours: 0, deliveries: 0, amount: 0 }); return byWorker.get(w); };
  for (const r of labor) {
    const e = get(r.worker);
    e.tested = n(r.tested); e.cleaned = n(r.cleaned); e.repaired = n(r.repaired); e.hours = n(r.hours);
  }
  for (const r of drivers) { get(r.worker).deliveries += n(r.deliveries); }

  for (const e of byWorker.values()) {
    const hourly = n(rates.perWorkerHourly[e.worker]) || n(rates.hourly);
    e.amount = e.tested * n(rates.test) + e.cleaned * n(rates.clean) + e.repaired * n(rates.repair)
      + e.deliveries * n(rates.delivery) + e.hours * hourly;
  }
  const workers = [...byWorker.values()].sort((a, b) => b.amount - a.amount);
  const total = workers.reduce((s, w) => s + w.amount, 0);
  return { weekOffset: Number(weekOffset) || 0, rates, workers, total };
}

// What the delivery side of the business actually makes.
//
// Dispatch already knew both halves of a job's money — `charge_amount` is what
// the client is billed, `pay_amount` is what the person who ran the stop is
// owed — but nothing ever put them next to each other, and the third number was
// missing entirely: fuel. A day of deliveries that grossed $900, paid out $400
// and burned $120 of diesel is a different business from one that grossed $900
// and burned $40, and until now there was no screen that could tell them apart.
//
// Three rules this file follows:
//
//  1. Revenue is what the CLIENT pays, whoever the client is. For an RS
//     Solutions job that is `charge_amount`, typed in by the office. For a
//     Bargain Bay delivery it is the delivery fee on the order — Bargain Bay is
//     just another client whose paperwork happens to live in the same database.
//     A charge typed onto a Bargain Bay job overrides the fee: explicit beats
//     inferred, always.
//  2. Nothing is invented. A stop with no charge and no fee counts as revenue
//     zero AND is reported as unpriced, because a total that quietly assumes
//     zero is worse than one that says what it doesn't know.
//  3. Only FINISHED work counts — done or failed. A stop still on the board
//     isn't money yet; a stop that couldn't be completed earns nothing and is
//     still counted, because it cost the same driver and the same fuel.
import { hasDb, query } from './db';
import { round2, TZ } from './constants';
import { ensureJobSchema, torontoToday } from './jobs';

let _schema = null;
export function ensureExpenseSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      -- Money the day cost that isn't attached to any one stop. Gas, overwhelmingly:
      -- a tank goes into a van, not into a delivery, and splitting it across the
      -- stops would be a guess dressed up as a figure. It is dated, not
      -- timestamped, because that is how a receipt works and how the office will
      -- enter it — often days later, out of the glovebox.
      CREATE TABLE IF NOT EXISTS dispatch_expenses (
        id serial PRIMARY KEY,
        expense_date date NOT NULL,
        kind text NOT NULL DEFAULT 'gas',
        amount numeric(10,2) NOT NULL,
        driver_id int,
        note text,
        created_by text, created_by_name text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_dispatch_expenses_date ON dispatch_expenses(expense_date);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

export const EXPENSE_KINDS = {
  gas: 'Gas',
  tolls: 'Tolls / 407',
  parking: 'Parking',
  maintenance: 'Van / maintenance',
  rental: 'Truck rental',
  helper: 'Helper (cash)',
  other: 'Other'
};

const asDate = (v, label = 'date') => {
  const s = String(v || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Give the ${label} as YYYY-MM-DD.`);
  return s;
};
const clean = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

// ── Expenses ─────────────────────────────────────────────────────────────────

export async function addExpense({ date, kind = 'gas', amount, driverId, note } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureExpenseSchema();
  const day = asDate(date) || torontoToday();
  const k = EXPENSE_KINDS[kind] ? kind : 'other';
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter what it cost, as a dollar amount.');
  const { rows } = await query(
    `INSERT INTO dispatch_expenses (expense_date, kind, amount, driver_id, note, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, expense_date, kind, amount, driver_id, note`,
    [day, k, round2(amt), driverId ? Number(driverId) : null, clean(note),
     by?.email || null, by?.name || null]
  );
  return shapeExpense(rows[0]);
}

export async function deleteExpense(id) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureExpenseSchema();
  const { rowCount } = await query('DELETE FROM dispatch_expenses WHERE id = $1', [Number(id)]);
  if (!rowCount) throw new Error('That entry is already gone.');
  return { deleted: true };
}

function shapeExpense(r) {
  return {
    id: r.id,
    date: r.expense_date ? r.expense_date.toISOString().slice(0, 10) : null,
    kind: r.kind, kindLabel: EXPENSE_KINDS[r.kind] || 'Other',
    amount: Number(r.amount) || 0,
    driverId: r.driver_id || null,
    driverName: r.driver_name || null,
    note: r.note || null,
    byName: r.created_by_name || null
  };
}

export async function listExpenses({ from, to } = {}) {
  if (!hasDb()) return [];
  await ensureExpenseSchema();
  const start = asDate(from, 'start date') || torontoToday();
  const end = asDate(to, 'end date') || start;
  const { rows } = await query(
    `SELECT e.*, COALESCE(u.name, u.email) AS driver_name
       FROM dispatch_expenses e
       LEFT JOIN users u ON u.id = e.driver_id
      WHERE e.expense_date BETWEEN $1::date AND $2::date
      ORDER BY e.expense_date DESC, e.id DESC`,
    [start, end]
  );
  return rows.map(shapeExpense);
}

// ── What a stop earned ───────────────────────────────────────────────────────
// The delivery fee is NOT stored on an order — it is what is left of the total
// once the goods, the promo discount and the tax are accounted for. That is the
// same derivation the order editor uses, and the discount term is why: leave it
// out and every order with a coupon on it reports a fee short by the discount.
//
// A stop that COULDN'T be completed earns nothing and is still counted, because
// it cost a driver's time and a tank's worth of the day either way. Leaving
// failed stops out entirely was the tidier query and the wrong number: a week
// with four failures would have reported a margin it never made.
const JOB_REVENUE = `
  CASE WHEN j.status = 'done' THEN COALESCE(
    j.charge_amount,
    CASE WHEN j.order_id IS NOT NULL
         THEN GREATEST(0, o.total - o.subtotal + COALESCE(o.discount, 0) - COALESCE(o.hst, 0))
    END,
    0) ELSE 0 END`;
const REVENUE_KNOWN = `(j.charge_amount IS NOT NULL OR j.order_id IS NOT NULL)`;
// Only a completed stop can be "missing" a price — a failed one has nothing to
// charge by definition, and flagging it would send the office looking for a
// number that doesn't exist.
const REVENUE_MISSING = `(j.status = 'done' AND NOT ${REVENUE_KNOWN})`;
const COUNTED = `j.status IN ('done','failed')`;
const HOURS = `EXTRACT(EPOCH FROM (j.time_out - j.time_in)) / 3600.0`;

const GROUPS = {
  day:   { sql: 'j.job_date', exp: 'e.expense_date' },
  week:  { sql: `date_trunc('week',  j.job_date)::date`, exp: `date_trunc('week',  e.expense_date)::date` },
  month: { sql: `date_trunc('month', j.job_date)::date`, exp: `date_trunc('month', e.expense_date)::date` }
};

// Anchored at noon and rendered in Toronto: this runs on the server, where the
// clock is UTC, and every date it prints is a date somebody in Ontario will
// compare against their own calendar.
function bucketLabel(key, group) {
  const at = (iso) => new Date(`${iso}T12:00:00Z`);
  const fmt = (d, opts) => d.toLocaleDateString('en-CA', { timeZone: TZ, ...opts });
  if (group === 'month') return fmt(at(key), { month: 'long', year: 'numeric' });
  if (group === 'week') {
    const end = new Date(at(key).getTime() + 6 * 86400000);
    const short = { month: 'short', day: 'numeric' };
    return `${fmt(at(key), short)} – ${fmt(end, short)}`;
  }
  return fmt(at(key), { weekday: 'short', month: 'short', day: 'numeric' });
}

// Daily, weekly or monthly: what the deliveries brought in, what they cost, and
// what was left. One row per period, plus the stops behind them so a number that
// looks wrong can be chased back to the job that made it.
export async function profitReport({ from, to, group = 'day' } = {}) {
  const g = GROUPS[group] ? group : 'day';
  const empty = { from, to, group: g, buckets: [], totals: {}, drivers: [], expenses: [], lines: [] };
  if (!hasDb()) return empty;
  await ensureJobSchema();
  await ensureExpenseSchema();
  const start = asDate(from, 'start date') || torontoToday();
  const end = asDate(to, 'end date') || start;

  const [work, spend, byDriver, lines, expenses] = await Promise.all([
    query(
      `SELECT ${GROUPS[g].sql} AS bucket,
              COUNT(*) FILTER (WHERE j.status = 'done')::int          AS jobs,
              COUNT(*) FILTER (WHERE j.status = 'failed')::int        AS failed,
              COUNT(*) FILTER (WHERE ${REVENUE_MISSING})::int         AS unpriced_revenue,
              COUNT(*) FILTER (WHERE j.pay_amount IS NULL)::int       AS unpriced_pay,
              COALESCE(SUM(${JOB_REVENUE}), 0)                        AS revenue,
              COALESCE(SUM(j.pay_amount), 0)                          AS driver_pay,
              COALESCE(SUM(${HOURS}) FILTER (WHERE j.time_in IS NOT NULL AND j.time_out IS NOT NULL), 0) AS hours
         FROM jobs j
         LEFT JOIN orders o ON o.id = j.order_id
        WHERE ${COUNTED} AND j.job_date BETWEEN $1::date AND $2::date
        GROUP BY 1`,
      [start, end]
    ),
    query(
      `SELECT ${GROUPS[g].exp} AS bucket,
              COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'gas'), 0) AS gas,
              COALESCE(SUM(e.amount) FILTER (WHERE e.kind <> 'gas'), 0) AS other
         FROM dispatch_expenses e
        WHERE e.expense_date BETWEEN $1::date AND $2::date
        GROUP BY 1`,
      [start, end]
    ),
    query(
      `SELECT j.driver_id,
              COALESCE(NULLIF(u.name,''), u.email, 'Unassigned') AS name,
              COUNT(*) FILTER (WHERE j.status = 'done')::int      AS jobs,
              COUNT(*) FILTER (WHERE j.status = 'failed')::int    AS failed,
              COALESCE(SUM(${JOB_REVENUE}), 0)                    AS revenue,
              COALESCE(SUM(j.pay_amount), 0)                      AS pay,
              COALESCE(SUM(${HOURS}) FILTER (WHERE j.time_in IS NOT NULL AND j.time_out IS NOT NULL), 0) AS hours
         FROM jobs j
         LEFT JOIN orders o ON o.id = j.order_id
         LEFT JOIN users u ON u.id = j.driver_id
        WHERE ${COUNTED} AND j.job_date BETWEEN $1::date AND $2::date
        GROUP BY 1, 2
        ORDER BY revenue DESC`,
      [start, end]
    ),
    query(
      `SELECT j.id, j.job_number, j.job_date, j.type, j.status, j.customer_name,
              j.address, j.city, j.time_in, j.time_out,
              j.charge_amount, j.pay_amount, j.order_id,
              ${JOB_REVENUE} AS revenue, ${REVENUE_KNOWN} AS revenue_known,
              o.order_number, c.name AS client_name,
              COALESCE(u.name, u.email) AS driver_name
         FROM jobs j
         LEFT JOIN orders o ON o.id = j.order_id
         LEFT JOIN clients c ON c.id = j.client_id
         LEFT JOIN users u ON u.id = j.driver_id
        WHERE ${COUNTED} AND j.job_date BETWEEN $1::date AND $2::date
        ORDER BY j.job_date DESC, j.seq NULLS LAST, j.id
        LIMIT 500`,
      [start, end]
    ),
    listExpenses({ from: start, to: end })
  ]);

  const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);
  const keys = new Set([...work.rows.map((r) => iso(r.bucket)), ...spend.rows.map((r) => iso(r.bucket))]);
  const spendBy = new Map(spend.rows.map((r) => [iso(r.bucket), r]));
  const workBy = new Map(work.rows.map((r) => [iso(r.bucket), r]));

  const buckets = [...keys].filter(Boolean).sort().reverse().map((key) => {
    const w = workBy.get(key) || {};
    const s = spendBy.get(key) || {};
    const revenue = round2(Number(w.revenue) || 0);
    const driverPay = round2(Number(w.driver_pay) || 0);
    const gas = round2(Number(s.gas) || 0);
    const other = round2(Number(s.other) || 0);
    const cost = round2(driverPay + gas + other);
    return {
      key, label: bucketLabel(key, g),
      jobs: w.jobs || 0,
      failed: w.failed || 0,
      hours: Math.round((Number(w.hours) || 0) * 100) / 100,
      revenue, driverPay, gas, otherCost: other, cost,
      profit: round2(revenue - cost),
      margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
      unpricedPay: w.unpriced_pay || 0,
      unpricedRevenue: w.unpriced_revenue || 0
    };
  });

  const sum = (f) => round2(buckets.reduce((a, b) => a + (b[f] || 0), 0));
  const totals = {
    jobs: buckets.reduce((a, b) => a + b.jobs, 0),
    failed: buckets.reduce((a, b) => a + b.failed, 0),
    hours: Math.round(buckets.reduce((a, b) => a + b.hours, 0) * 100) / 100,
    revenue: sum('revenue'), driverPay: sum('driverPay'), gas: sum('gas'),
    otherCost: sum('otherCost'), cost: sum('cost'), profit: sum('profit'),
    unpricedPay: buckets.reduce((a, b) => a + b.unpricedPay, 0),
    unpricedRevenue: buckets.reduce((a, b) => a + b.unpricedRevenue, 0)
  };
  totals.margin = totals.revenue > 0
    ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : null;

  return {
    from: start, to: end, group: g, buckets, totals, expenses,
    drivers: byDriver.rows.map((r) => ({
      driverId: r.driver_id, name: r.name, jobs: r.jobs, failed: r.failed || 0,
      revenue: round2(Number(r.revenue) || 0),
      pay: round2(Number(r.pay) || 0),
      hours: Math.round((Number(r.hours) || 0) * 100) / 100
    })),
    lines: lines.rows.map((r) => ({
      id: r.id, jobNumber: r.job_number, date: iso(r.job_date), type: r.type,
      status: r.status,
      customerName: r.customer_name,
      where: [r.address, r.city].filter(Boolean).join(', ') || null,
      clientName: r.client_name || (r.order_id ? 'Bargain Bay' : null),
      orderNumber: r.order_number || null,
      driverName: r.driver_name || null,
      timeIn: r.time_in ? r.time_in.toISOString() : null,
      timeOut: r.time_out ? r.time_out.toISOString() : null,
      minutes: r.time_in && r.time_out
        ? Math.round((new Date(r.time_out) - new Date(r.time_in)) / 60000) : null,
      revenue: round2(Number(r.revenue) || 0),
      // A failed stop has nothing to charge; it is not an unpriced one.
      revenueKnown: r.status !== 'done' ? true : !!r.revenue_known,
      // Where the revenue figure came from matters when it looks wrong: a typed
      // charge is somebody's decision, an order fee is arithmetic.
      revenueFrom: r.charge_amount != null ? 'charge' : (r.order_id ? 'order_fee' : null),
      pay: r.pay_amount == null ? null : Number(r.pay_amount)
    }))
  };
}

// ── The times, as a history ──────────────────────────────────────────────────
// Every stop in the period with the clock beside it: when the driver got there,
// when they finished, how long it took. Two flags matter more than the rest —
// a stop finished with no times on it (nobody can bill or cost that), and a stop
// still clocked IN after its day is over, which is the forgotten Done tap.
export async function stopTimes({ from, to, driverId } = {}) {
  if (!hasDb()) return { from, to, rows: [], openNow: [], missing: 0 };
  await ensureJobSchema();
  const start = asDate(from, 'start date') || torontoToday();
  const end = asDate(to, 'end date') || start;
  const drv = driverId ? Number(driverId) : null;

  const { rows } = await query(
    `SELECT j.id, j.job_number, j.job_date, j.type, j.status, j.seq,
            j.customer_name, j.address, j.city,
            j.window_start, j.window_end,
            j.started_at, j.arrived_at, j.time_in, j.time_out, j.completed_at,
            j.pay_amount, j.charge_amount,
            o.order_number, c.name AS client_name,
            COALESCE(u.name, u.email)  AS driver_name,
            COALESCE(u2.name, u2.email) AS mate_name
       FROM jobs j
       LEFT JOIN orders o  ON o.id  = j.order_id
       LEFT JOIN clients c ON c.id  = j.client_id
       LEFT JOIN users u   ON u.id  = j.driver_id
       LEFT JOIN users u2  ON u2.id = j.driver2_id
      WHERE j.status <> 'cancelled'
        AND j.job_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR j.driver_id = $3 OR j.driver2_id = $3)
      ORDER BY j.job_date DESC, driver_name NULLS LAST, j.seq NULLS LAST, j.id`,
    [start, end, drv]
  );

  const today = torontoToday();
  const out = rows.map((r) => {
    const timeIn = r.time_in || r.arrived_at;
    const day = r.job_date ? r.job_date.toISOString().slice(0, 10) : null;
    return {
      id: r.id, jobNumber: r.job_number, date: day, type: r.type, status: r.status,
      customerName: r.customer_name,
      where: [r.address, r.city].filter(Boolean).join(', ') || null,
      clientName: r.client_name || (r.order_number ? 'Bargain Bay' : null),
      orderNumber: r.order_number || null,
      driverName: r.driver_name || null, mateName: r.mate_name || null,
      windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null,
      windowEnd: r.window_end ? String(r.window_end).slice(0, 5) : null,
      leftAt: r.started_at ? r.started_at.toISOString() : null,
      timeIn: timeIn ? timeIn.toISOString() : null,
      timeOut: r.time_out ? r.time_out.toISOString() : null,
      minutes: timeIn && r.time_out ? Math.round((new Date(r.time_out) - new Date(timeIn)) / 60000) : null,
      pay: r.pay_amount == null ? null : Number(r.pay_amount),
      charge: r.charge_amount == null ? null : Number(r.charge_amount),
      // Finished, but there is no clock on it — the pay hours and the cost per
      // stop are both blind here until somebody types the times in.
      missingTimes: r.status === 'done' && !(timeIn && r.time_out),
      // Clocked in, never clocked out, and the day is over.
      stuckOpen: !!(timeIn && !r.time_out && day && day < today
                    && !['done', 'failed'].includes(r.status))
    };
  });

  return {
    from: start, to: end, rows: out,
    missing: out.filter((r) => r.missingTimes).length,
    stuck: out.filter((r) => r.stuckOpen).length
  };
}

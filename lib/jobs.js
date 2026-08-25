// Dispatch — deliveries and service calls, whatever company they came from.
//
// The daily run sheet used to be built by hand because the work arrives from
// several clients through several channels (email, spreadsheet, phone) and no
// one system holds all of it. So a JOB is deliberately source-agnostic: it can
// be typed in by any staff member in thirty seconds, or pulled from a Bargain
// Bay order, and the board treats both the same.
//
// A job is NOT an order. Orders carry money, tax, inventory and revenue meaning;
// a service call for another company carries none of that, and putting it in the
// orders table would pollute every revenue query. A Bargain Bay delivery becomes
// a job that links back to its order via jobs.order_id.
import { hasDb, query, withTransaction } from './db';

// Self-provision, same pattern as the rest of the app: the tables are in
// db/schema.sql for a fresh database, and this covers a deploy where the
// migration hasn't been run yet.
let _schema = null;
function ensureJobSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS clients (
        id serial PRIMARY KEY, name text NOT NULL UNIQUE,
        contact_email text, contact_phone text, notes text,
        notify_on_complete boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id serial PRIMARY KEY, job_number text UNIQUE,
        type text NOT NULL DEFAULT 'delivery',
        status text NOT NULL DEFAULT 'unscheduled',
        client_id int, source text NOT NULL DEFAULT 'manual', order_id int,
        customer_name text, phone text, email text,
        address text, city text, postal text,
        lat numeric(9,6), lng numeric(9,6),
        job_date date, window_start time, window_end time,
        driver_id int, seq int, notes text, fail_reason text,
        created_by text, created_by_name text,
        created_at timestamptz DEFAULT now(),
        started_at timestamptz, arrived_at timestamptz, completed_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS job_items (
        id serial PRIMARY KEY, job_id int REFERENCES jobs(id) ON DELETE CASCADE,
        description text NOT NULL, sku text, qty int NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS job_events (
        id serial PRIMARY KEY, job_id int REFERENCES jobs(id) ON DELETE CASCADE,
        event text NOT NULL, detail text, by_email text, by_name text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_date        ON jobs(job_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_driver_date ON jobs(driver_id, job_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_job_items_job    ON job_items(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_events_job   ON job_events(job_id);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

export const JOB_TYPES = {
  delivery: 'Delivery',
  service_call: 'Service call',
  pickup: 'Pickup'
};

export const JOB_STATUSES = {
  unscheduled: 'Unscheduled',
  scheduled: 'Scheduled',
  on_the_way: 'On the way',
  arrived: 'Arrived',
  done: 'Done',
  failed: "Couldn't complete",
  cancelled: 'Cancelled'
};

// Why a stop didn't happen. A failed stop is a real outcome someone has to act
// on today — not an absence of a completion.
export const FAIL_REASONS = {
  no_answer: 'Nobody home',
  refused: 'Customer refused',
  wrong_address: 'Wrong / bad address',
  no_access: "Wouldn't fit / no access",
  damaged: 'Item damaged',
  rescheduled: 'Customer rescheduled',
  other: 'Other'
};

// Promised delivery windows. Coarse blocks on purpose: they're what customers
// actually understand, and they let routing stay cheap — stops are grouped by
// window and only optimised WITHIN a group, so a route can never be reordered
// across a promise. Custom start/end is still accepted for a one-off.
export const WINDOW_PRESETS = [
  { key: 'am',     label: 'Morning · 8–12',   start: '08:00', end: '12:00' },
  { key: 'pm',     label: 'Afternoon · 12–4', start: '12:00', end: '16:00' },
  { key: 'eve',    label: 'Evening · 4–8',    start: '16:00', end: '20:00' },
  { key: 'allday', label: 'Any time · 8–8',   start: '08:00', end: '20:00' }
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
};

// Business days run on Toronto time everywhere else in the app; dispatch too.
export function torontoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function normalizeWindow({ windowKey, windowStart, windowEnd }) {
  const preset = WINDOW_PRESETS.find((w) => w.key === windowKey);
  if (preset) return { start: preset.start, end: preset.end };
  const s = clean(windowStart, 5);
  const e = clean(windowEnd, 5);
  if (s && e && HHMM.test(s) && HHMM.test(e)) {
    if (e <= s) throw new Error('The delivery window has to end after it starts.');
    return { start: s, end: e };
  }
  return { start: null, end: null };
}

function normalizeDate(input, label = 'date') {
  const s = String(input || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`The ${label} must look like 2026-08-25.`);
  return s;
}

async function logEvent(client, jobId, event, detail, by) {
  await client.query(
    'INSERT INTO job_events (job_id, event, detail, by_email, by_name) VALUES ($1,$2,$3,$4,$5)',
    [jobId, event, detail || null, by?.email || null, by?.name || null]
  );
}

// ── Clients (the companies whose work we run) ────────────────────────────────
export async function listClients({ includeInactive = false } = {}) {
  if (!hasDb()) return [];
  await ensureJobSchema();
  const { rows } = await query(
    `SELECT id, name, contact_email, contact_phone, notify_on_complete, active
       FROM clients ${includeInactive ? '' : 'WHERE active = true'}
      ORDER BY name`
  );
  return rows;
}

export async function upsertClient({ id, name, contactEmail, contactPhone, notifyOnComplete, active = true }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const nm = clean(name, 120);
  if (!nm) throw new Error('The client needs a name.');
  if (id) {
    const { rows } = await query(
      `UPDATE clients SET name = $2, contact_email = $3, contact_phone = $4,
              notify_on_complete = $5, active = $6
        WHERE id = $1 RETURNING *`,
      [Number(id), nm, clean(contactEmail), clean(contactPhone), !!notifyOnComplete, !!active]
    );
    return rows[0] || null;
  }
  const { rows } = await query(
    `INSERT INTO clients (name, contact_email, contact_phone, notify_on_complete)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE SET active = true
     RETURNING *`,
    [nm, clean(contactEmail), clean(contactPhone), !!notifyOnComplete]
  );
  return rows[0] || null;
}

// ── Creating work ────────────────────────────────────────────────────────────
// The fast path: any staff member can put a job on the board in one call. Only
// an address is genuinely required — everything else can be filled in later,
// because half of these are typed while the customer is still on the phone.
export async function createJob({
  type = 'delivery', clientId, source = 'manual', orderId,
  customerName, phone, email, address, city, postal, lat, lng,
  jobDate, windowKey, windowStart, windowEnd,
  driverId, notes, items = [], createdBy
} = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();

  const addr = clean(address, 300);
  if (!addr) throw new Error('A job needs an address — everything else can wait.');
  if (!JOB_TYPES[type]) throw new Error('Pick a job type.');

  const date = normalizeDate(jobDate, 'job date');
  const win = normalizeWindow({ windowKey, windowStart, windowEnd });
  const lines = (Array.isArray(items) ? items : [])
    .map((it) => ({
      description: clean(typeof it === 'string' ? it : it?.description, 300),
      sku: clean(typeof it === 'string' ? null : it?.sku, 60),
      qty: Math.max(parseInt(typeof it === 'string' ? 1 : it?.qty, 10) || 1, 1)
    }))
    .filter((it) => it.description);

  const author = {
    email: String(createdBy?.email || '').trim().toLowerCase() || null,
    name: String(createdBy?.name || '').trim() || null
  };

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO jobs (type, status, client_id, source, order_id,
                         customer_name, phone, email, address, city, postal, lat, lng,
                         job_date, window_start, window_end, driver_id, notes,
                         created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [type, date ? 'scheduled' : 'unscheduled',
       clientId ? Number(clientId) : null, source, orderId ? Number(orderId) : null,
       clean(customerName, 160), clean(phone, 40), clean(email, 200),
       addr, clean(city, 120), clean(postal, 20),
       Number.isFinite(Number(lat)) ? Number(lat) : null,
       Number.isFinite(Number(lng)) ? Number(lng) : null,
       date, win.start, win.end, driverId ? Number(driverId) : null, clean(notes, 1000),
       author.email, author.name]
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE jobs SET job_number = 'RS-' || (1000 + id) WHERE id = $1 RETURNING job_number`,
      [id]
    );
    for (const li of lines) {
      await client.query(
        'INSERT INTO job_items (job_id, description, sku, qty) VALUES ($1,$2,$3,$4)',
        [id, li.description, li.sku, li.qty]
      );
    }
    await logEvent(client, id, 'created', `${JOB_TYPES[type]}${date ? ` for ${date}` : ' (no date yet)'}`, author);
    return { id, jobNumber: num[0].job_number };
  });
}

// ── The board ────────────────────────────────────────────────────────────────
// Everything for one day, plus the unscheduled backlog, in one round trip.
export async function dispatchBoard(dateStr) {
  const empty = { date: dateStr, jobs: [], unscheduled: [], drivers: [], clients: [] };
  if (!hasDb()) return empty;
  await ensureJobSchema();
  const date = normalizeDate(dateStr, 'board date') || torontoToday();

  const select = `
    SELECT j.id, j.job_number, j.type, j.status, j.source, j.order_id,
           j.customer_name, j.phone, j.email, j.address, j.city, j.postal,
           j.job_date, j.window_start, j.window_end, j.driver_id, j.seq, j.notes,
           j.fail_reason, j.created_by_name, j.created_at,
           c.name AS client_name,
           COALESCE(u.name, u.email) AS driver_name,
           (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'description', i.description, 'sku', i.sku, 'qty', i.qty) ORDER BY i.id), '[]'::json)
              FROM job_items i WHERE i.job_id = j.id) AS items
      FROM jobs j
      LEFT JOIN clients c ON c.id = j.client_id
      LEFT JOIN users   u ON u.id = j.driver_id`;

  const [day, backlog, drivers, clients] = await Promise.all([
    query(`${select} WHERE j.job_date = $1 AND j.status <> 'cancelled'
            ORDER BY j.driver_id NULLS FIRST, j.seq NULLS LAST, j.window_start NULLS LAST, j.id`, [date]),
    // The backlog: work that's on the books with no day yet. Capped — this is a
    // to-schedule pile, and if it's longer than this the board isn't the problem.
    query(`${select} WHERE j.job_date IS NULL AND j.status = 'unscheduled'
            ORDER BY j.created_at LIMIT 50`),
    query(`SELECT id, COALESCE(name, email) AS name, phone FROM users WHERE is_driver = true ORDER BY name NULLS LAST, email`),
    listClients()
  ]);

  const shape = (r) => ({
    id: r.id, jobNumber: r.job_number, type: r.type, status: r.status, source: r.source,
    orderId: r.order_id, customerName: r.customer_name, phone: r.phone, email: r.email,
    address: r.address, city: r.city, postal: r.postal,
    jobDate: r.job_date ? r.job_date.toISOString().slice(0, 10) : null,
    windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null,
    windowEnd: r.window_end ? String(r.window_end).slice(0, 5) : null,
    driverId: r.driver_id, driverName: r.driver_name, seq: r.seq,
    notes: r.notes, failReason: r.fail_reason, createdByName: r.created_by_name,
    items: Array.isArray(r.items) ? r.items : []
  });

  return {
    date,
    jobs: day.rows.map(shape),
    unscheduled: backlog.rows.map(shape),
    drivers: drivers.rows,
    clients
  };
}

export async function getJob(id) {
  if (!hasDb()) return null;
  await ensureJobSchema();
  const { rows } = await query('SELECT * FROM jobs WHERE id = $1', [Number(id)]);
  if (!rows.length) return null;
  const { rows: items } = await query('SELECT id, description, sku, qty FROM job_items WHERE job_id = $1 ORDER BY id', [Number(id)]);
  const { rows: events } = await query(
    'SELECT event, detail, by_name, at FROM job_events WHERE job_id = $1 ORDER BY at, id', [Number(id)]
  );
  return { ...rows[0], items, events };
}

// ── Moving work around ───────────────────────────────────────────────────────
// Assign (or unassign) a job: driver, day, and position in that driver's run.
// Putting a job on a day is what moves it from 'unscheduled' to 'scheduled';
// clearing the day sends it back to the backlog.
export async function assignJob(jobId, { driverId, jobDate, seq } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const id = Number(jobId);
  const date = jobDate === null ? null : normalizeDate(jobDate, 'job date');
  const drv = driverId === null || driverId === '' ? null : Number(driverId);

  const { rows: cur } = await query('SELECT status, job_date, driver_id FROM jobs WHERE id = $1', [id]);
  if (!cur.length) throw new Error('Job not found.');
  if (['done', 'failed', 'cancelled'].includes(cur[0].status)) {
    throw new Error('That job is already closed — reopen it before reassigning.');
  }

  const nextDate = jobDate === undefined ? cur[0].job_date : date;
  const { rows } = await query(
    `UPDATE jobs SET
       driver_id = $2,
       job_date  = $3,
       seq       = $4,
       status    = CASE WHEN $3::date IS NULL THEN 'unscheduled'
                        WHEN status = 'unscheduled' THEN 'scheduled'
                        ELSE status END
     WHERE id = $1
     RETURNING id, job_number, driver_id, job_date, seq, status`,
    [id, driverId === undefined ? cur[0].driver_id : drv, nextDate,
     seq == null ? null : Number(seq)]
  );
  const j = rows[0];
  await withTransaction((client) => logEvent(
    client, id, 'assigned',
    `${j.driver_id ? `driver #${j.driver_id}` : 'unassigned'}${j.job_date ? ` · ${j.job_date.toISOString().slice(0, 10)}` : ' · no date'}`,
    by
  ));
  return j;
}

// Reorder one driver's day in a single call — the board sends the whole column
// after a move, so positions can never end up with gaps or duplicates.
export async function resequence(driverId, dateStr, orderedJobIds = [], by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const date = normalizeDate(dateStr, 'board date');
  const ids = (orderedJobIds || []).map((n) => Number(n)).filter(Number.isFinite);
  if (!ids.length) return { updated: 0 };
  await withTransaction(async (client) => {
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        'UPDATE jobs SET seq = $2, driver_id = $3, job_date = $4 WHERE id = $1',
        [ids[i], i + 1, driverId ? Number(driverId) : null, date]
      );
    }
    await logEvent(client, ids[0], 'resequenced', `${ids.length} stop(s) reordered`, by);
  });
  return { updated: ids.length };
}

// Status moves. 'failed' demands a reason — a stop that didn't happen is
// information, and "no reason given" is how it gets lost.
export async function setJobStatus(jobId, status, { failReason, note } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  if (!JOB_STATUSES[status]) throw new Error('Unknown job status.');
  if (status === 'failed' && !FAIL_REASONS[failReason]) {
    throw new Error('Say why it couldn\'t be completed — otherwise nobody can act on it.');
  }
  const id = Number(jobId);
  const stamp = {
    on_the_way: 'started_at',
    arrived: 'arrived_at',
    done: 'completed_at',
    failed: 'completed_at'
  }[status];

  const { rows } = await query(
    `UPDATE jobs SET status = $2,
            fail_reason = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END
            ${stamp ? `, ${stamp} = COALESCE(${stamp}, now())` : ''}
      WHERE id = $1
      RETURNING id, job_number, status, order_id`,
    [id, status, status === 'failed' ? failReason : null]
  );
  if (!rows.length) throw new Error('Job not found.');
  await withTransaction((client) => logEvent(
    client, id, status,
    status === 'failed' ? `${FAIL_REASONS[failReason]}${note ? ` — ${note}` : ''}` : (note || null),
    by
  ));
  return rows[0];
}

export async function cancelJob(jobId, reason, by) {
  return setJobStatus(jobId, 'cancelled', { note: reason }, by);
}

// ── Bargain Bay orders → the board ───────────────────────────────────────────
// Deliberately a pull, not a push: the dispatcher decides what enters the day,
// and nothing new hangs off the order-status path (which the storefront depends
// on). Idempotent — an order that already has a job is skipped.
export async function importReadyBargainBayOrders({ by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.name, o.email, o.phone,
            o.address, o.city, o.postal, o.delivery_date
       FROM orders o
      WHERE o.delivery_method = 'delivery'
        AND o.status IN ('confirmed','ready')
        AND COALESCE(o.address,'') <> ''
        AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.order_id = o.id)
      ORDER BY o.created_at`
  );
  const created = [];
  for (const o of rows) {
    try {
      const { rows: its } = await query('SELECT sku, title FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
      const job = await createJob({
        type: 'delivery', source: 'bargain_bay', orderId: o.id,
        customerName: o.name, phone: o.phone, email: o.email,
        address: o.address, city: o.city, postal: o.postal,
        jobDate: o.delivery_date ? o.delivery_date.toISOString().slice(0, 10) : null,
        items: its.map((r) => ({ description: r.title || r.sku, sku: r.sku })),
        notes: `Bargain Bay order ${o.order_number}.`,
        createdBy: by
      });
      created.push({ order: o.order_number, job: job.jobNumber });
    } catch (e) {
      console.error('import BB order to dispatch failed', o.order_number, e.message);
    }
  }
  return { imported: created.length, created };
}

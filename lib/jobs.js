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
      CREATE TABLE IF NOT EXISTS service_tickets (
        id serial PRIMARY KEY, ticket_number text UNIQUE, client_id int,
        customer_name text, phone text, email text,
        address text, city text, postal text,
        appliance text, issue text,
        status text NOT NULL DEFAULT 'open',
        priority text NOT NULL DEFAULT 'normal',
        opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
        created_by text, created_by_name text
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON service_tickets(status);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ticket_id     int;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shipment_type text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS services      text[];
      ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS order_id int;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_in       timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_out      timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome       text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_used    text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_needed  text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_by     text;
      CREATE INDEX IF NOT EXISTS idx_jobs_ticket ON jobs(ticket_id) WHERE ticket_id IS NOT NULL;
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

// How a service visit ended. 'pending' and 'parts_needed' both leave the ticket
// open — the visit is finished, the customer's problem isn't.
export const SERVICE_OUTCOMES = {
  fixed:        'Fixed',
  parts_needed: 'Parts needed',
  not_fixed:    'Not fixed',
  pending:      'Pending — needs another visit',
  no_fault:     'No fault found'
};

// Where a visit outcome leaves the ticket.
const OUTCOME_TO_TICKET = {
  fixed: 'resolved',
  no_fault: 'resolved',
  parts_needed: 'awaiting_parts',
  not_fixed: 'open',
  pending: 'open'
};

export const TICKET_STATUSES = {
  open: 'Open',
  awaiting_parts: 'Awaiting parts',
  scheduled: 'Visit booked',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled'
};

// A ticket still needing work. This is the number the owner asked for.
export const TICKET_OPEN_STATES = ['open', 'awaiting_parts', 'scheduled'];

// How far into the property the crew goes. Two values, and the driver needs to
// know which before they get out of the van — white glove means into the room,
// unpacked and placed; threshold means the door and no further.
export const SHIPMENT_TYPES = {
  white_glove: 'White glove',
  threshold: 'Threshold'
};

// What's actually being done on the stop. Multi-select, because one visit is
// routinely a delivery AND an install AND a haul-away, and the crew has to know
// all three before they load. Kept as tags rather than free text so they can be
// counted and filtered later; free-form detail goes in the job's notes.
export const JOB_SERVICES = {
  delivery_only: 'Delivery only',
  install: 'Install',
  haul_away: 'Haul away',
  exchange: 'Exchange / swap',
  return_pickup: 'Return pickup',
  parts_drop: 'Parts drop-off',
  warranty: 'Warranty call'
};

// Promised delivery windows. The team sets these per job and they can start at
// ANY hour, so an arbitrary start/end is the real input — the presets below are
// only one-tap shortcuts for the common ones.
//
// Routing (phase 3) still stays on the cheap Directions API despite arbitrary
// windows: sort stops by window_start, and only let stops whose windows OVERLAP
// be reordered against each other. A route can then never be resequenced across
// a promise, which is the main thing the expensive fleet solver buys.
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
  type = 'delivery', clientId, source = 'manual', orderId, ticketId,
  customerName, phone, email, address, city, postal, lat, lng,
  jobDate, windowKey, windowStart, windowEnd,
  driverId, notes, items = [], shipmentType, services, appliance, issue, createdBy
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

  // Unknown values are dropped rather than stored — a typo'd shipment type that
  // silently persists is worse than a blank one.
  const shipment = SHIPMENT_TYPES[shipmentType] ? shipmentType : null;
  const svc = [...new Set((Array.isArray(services) ? services : []).filter((k) => JOB_SERVICES[k]))];

  const author = {
    email: String(createdBy?.email || '').trim().toLowerCase() || null,
    name: String(createdBy?.name || '').trim() || null
  };

  // A service call is a visit against a TICKET — the customer's problem, which
  // routinely outlives one trip. Reuse the ticket when the caller names one
  // (a revisit); otherwise open a new one so the count of open service calls is
  // a count of problems, not of trips.
  let ticket = null;
  if (type === 'service_call') {
    ticket = ticketId
      ? await getTicket(ticketId)
      : await openTicket({
          clientId, customerName, phone, email, address, city, postal,
          appliance, issue: issue || notes, orderId, createdBy
        });
    if (!ticket) throw new Error('That service ticket no longer exists.');
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO jobs (type, status, client_id, source, order_id,
                         customer_name, phone, email, address, city, postal, lat, lng,
                         job_date, window_start, window_end, driver_id, notes,
                         created_by, created_by_name, shipment_type, ticket_id, services)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING id`,
      [type, date ? 'scheduled' : 'unscheduled',
       clientId ? Number(clientId) : null, source, orderId ? Number(orderId) : null,
       clean(customerName, 160), clean(phone, 40), clean(email, 200),
       addr, clean(city, 120), clean(postal, 20),
       Number.isFinite(Number(lat)) ? Number(lat) : null,
       Number.isFinite(Number(lng)) ? Number(lng) : null,
       date, win.start, win.end, driverId ? Number(driverId) : null, clean(notes, 1000),
       author.email, author.name, shipment, ticket ? ticket.id : null, svc]
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
    if (ticket && date) {
      await client.query(
        "UPDATE service_tickets SET status = 'scheduled' WHERE id = $1 AND status IN ('open','awaiting_parts')",
        [ticket.id]
      );
    }
    await logEvent(client, id, 'created', `${JOB_TYPES[type]}${date ? ` for ${date}` : ' (no date yet)'}`, author);
    return { id, jobNumber: num[0].job_number, ticketId: ticket?.id || null, ticketNumber: ticket?.ticket_number || null };
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
           j.shipment_type, j.services, j.ticket_id, j.outcome, j.parts_needed,
           t.ticket_number, t.appliance, t.issue,
           c.name AS client_name,
           COALESCE(u.name, u.email) AS driver_name,
           (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'description', i.description, 'sku', i.sku, 'qty', i.qty) ORDER BY i.id), '[]'::json)
              FROM job_items i WHERE i.job_id = j.id) AS items
      FROM jobs j
      LEFT JOIN clients c ON c.id = j.client_id
      LEFT JOIN users   u ON u.id = j.driver_id
      LEFT JOIN service_tickets t ON t.id = j.ticket_id`;

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
    clientName: r.client_name,
    shipmentType: r.shipment_type || null,
    services: Array.isArray(r.services) ? r.services : [],
    ticketId: r.ticket_id || null, ticketNumber: r.ticket_number || null,
    appliance: r.appliance || null, issue: r.issue || null,
    outcome: r.outcome || null, partsNeeded: r.parts_needed || null,
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

// ── Service tickets ──────────────────────────────────────────────────────────
// The ticket is the customer's problem; a job is one visit against it. Keeping
// them separate is what makes "how many open service calls?" answerable — a
// three-trip repair is one open call, not three.
export async function openTicket({
  clientId, customerName, phone, email, address, city, postal,
  appliance, issue, priority = 'normal', orderId, createdBy
} = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const author = {
    email: String(createdBy?.email || '').trim().toLowerCase() || null,
    name: String(createdBy?.name || '').trim() || null
  };
  const { rows } = await query(
    `INSERT INTO service_tickets
       (client_id, customer_name, phone, email, address, city, postal,
        appliance, issue, priority, created_by, created_by_name, order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [clientId ? Number(clientId) : null, clean(customerName, 160), clean(phone, 40), clean(email, 200),
     clean(address, 300), clean(city, 120), clean(postal, 20),
     clean(appliance, 200), clean(issue, 2000),
     priority === 'urgent' ? 'urgent' : 'normal', author.email, author.name,
     orderId ? Number(orderId) : null]
  );
  const { rows: num } = await query(
    `UPDATE service_tickets SET ticket_number = 'SC-' || (1000 + id) WHERE id = $1 RETURNING *`,
    [rows[0].id]
  );
  return num[0];
}

export async function getTicket(id) {
  if (!hasDb()) return null;
  await ensureJobSchema();
  const { rows } = await query('SELECT * FROM service_tickets WHERE id = $1', [Number(id)]);
  return rows[0] || null;
}

// The ticket queue: what's still open, oldest first, with its visit history.
// `days` on each row is how long the customer has been waiting — the number that
// actually tells you which one to chase.
export async function listTickets({ status = 'open_states', limit = 100 } = {}) {
  if (!hasDb()) return { tickets: [], counts: {} };
  await ensureJobSchema();
  const openList = TICKET_OPEN_STATES.map((s) => `'${s}'`).join(',');
  const where = status === 'open_states'
    ? `t.status IN (${openList})`
    : (TICKET_STATUSES[status] ? `t.status = $2` : 'TRUE');
  const params = [Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300)];
  if (where.includes('$2')) params.push(status);

  const { rows } = await query(
    `SELECT t.*, c.name AS client_name,
            EXTRACT(DAY FROM (now() - t.opened_at))::int AS days,
            (SELECT COUNT(*) FROM jobs j WHERE j.ticket_id = t.id) AS visits,
            (SELECT MAX(j.job_date) FROM jobs j WHERE j.ticket_id = t.id) AS last_visit,
            o.order_number,
            (SELECT j.parts_needed FROM jobs j
              WHERE j.ticket_id = t.id AND COALESCE(j.parts_needed,'') <> ''
              ORDER BY j.id DESC LIMIT 1) AS parts_needed
       FROM service_tickets t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN orders  o ON o.id = t.order_id
      WHERE ${where}
      ORDER BY (t.priority = 'urgent') DESC, t.opened_at
      LIMIT $1`,
    params
  );
  const { rows: counts } = await query(
    'SELECT status, COUNT(*)::int AS n FROM service_tickets GROUP BY status'
  );
  return {
    tickets: rows.map((r) => ({
      id: r.id, ticketNumber: r.ticket_number, status: r.status, priority: r.priority,
      clientName: r.client_name, customerName: r.customer_name, phone: r.phone,
      address: r.address, city: r.city,
      appliance: r.appliance, issue: r.issue,
      days: Number(r.days) || 0, visits: Number(r.visits) || 0,
      lastVisit: r.last_visit ? r.last_visit.toISOString().slice(0, 10) : null,
      partsNeeded: r.parts_needed || null,
      orderNumber: r.order_number || null,
      openedAt: r.opened_at ? r.opened_at.toISOString() : null
    })),
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n]))
  };
}

export async function openTicketCount() {
  if (!hasDb()) return 0;
  try {
    await ensureJobSchema();
    const openList = TICKET_OPEN_STATES.map((s) => `'${s}'`).join(',');
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM service_tickets WHERE status IN (${openList})`);
    return Number(rows[0]?.n) || 0;
  } catch { return 0; }
}

export async function setTicketStatus(ticketId, status, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  if (!TICKET_STATUSES[status]) throw new Error('Unknown ticket status.');
  const { rows } = await query(
    `UPDATE service_tickets SET status = $2,
            closed_at = CASE WHEN $2 IN ('resolved','closed','cancelled') THEN COALESCE(closed_at, now()) ELSE NULL END
      WHERE id = $1 RETURNING id, ticket_number, status`,
    [Number(ticketId), status]
  );
  if (!rows.length) throw new Error('Ticket not found.');
  return rows[0];
}

// ── Completing a service visit ───────────────────────────────────────────────
// Time on site, what was done, what parts went in or are still needed, and who
// signed. The outcome is what moves the ticket: fixed closes it, parts needed
// parks it, pending leaves it open for another trip.
export async function completeServiceVisit(jobId, {
  timeIn, timeOut, outcome, partsUsed, partsNeeded, signedBy, note
} = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  if (!SERVICE_OUTCOMES[outcome]) throw new Error('Pick how the visit ended.');
  const id = Number(jobId);

  const { rows: cur } = await query('SELECT id, job_number, type, ticket_id FROM jobs WHERE id = $1', [id]);
  if (!cur.length) throw new Error('Job not found.');
  if (cur[0].type !== 'service_call') throw new Error('That job is not a service call.');

  const { rows } = await query(
    `UPDATE jobs SET
       status       = 'done',
       outcome      = $2,
       parts_used   = $3,
       parts_needed = $4,
       signed_by    = $5,
       time_in      = COALESCE($6::timestamptz, time_in, now()),
       time_out     = COALESCE($7::timestamptz, now()),
       completed_at = COALESCE(completed_at, now())
     WHERE id = $1
     RETURNING id, job_number, ticket_id, outcome`,
    [id, outcome, clean(partsUsed, 1000), clean(partsNeeded, 1000), clean(signedBy, 160),
     timeIn || null, timeOut || null]
  );

  const next = OUTCOME_TO_TICKET[outcome];
  if (rows[0].ticket_id && next) {
    await query(
      `UPDATE service_tickets SET status = $2,
              closed_at = CASE WHEN $2 = 'resolved' THEN COALESCE(closed_at, now()) ELSE NULL END
        WHERE id = $1 AND status NOT IN ('closed','cancelled')`,
      [rows[0].ticket_id, next]
    );
  }
  await withTransaction((client) => logEvent(
    client, id, 'service_complete',
    `${SERVICE_OUTCOMES[outcome]}${partsUsed ? ` · parts used: ${partsUsed}` : ''}${partsNeeded ? ` · parts needed: ${partsNeeded}` : ''}${note ? ` — ${note}` : ''}`,
    by
  ));
  return rows[0];
}

// ── Looking up a Bargain Bay sale to raise a service call against ────────────
// A warranty call on something we sold should point back at the order, so the
// unit, the price and the sale date are all one click away later — and so the
// same fridge coming back twice is visible. External clients skip all this and
// just get typed in.
export async function findServiceCustomers(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!hasDb() || needle.length < 2) return [];
  const like = `%${needle}%`;
  const digits = needle.replace(/\D/g, '');
  const { rows } = await query(
    `SELECT DISTINCT ON (lower(o.email))
            lower(o.email) AS email,
            COALESCE(NULLIF(o.name,''), lower(o.email)) AS name,
            o.phone, o.address, o.city, o.postal,
            COUNT(*) OVER (PARTITION BY lower(o.email)) AS orders
       FROM orders o
      WHERE o.status NOT IN ('cancelled')
        AND (lower(COALESCE(o.name,'')) LIKE $1
             OR lower(o.email) LIKE $1
             OR ($2 <> '' AND regexp_replace(COALESCE(o.phone,''), '\\D', '', 'g') LIKE $2)
             OR lower(COALESCE(o.order_number,'')) LIKE $1)
      ORDER BY lower(o.email), o.created_at DESC
      LIMIT 8`,
    [like, digits.length >= 3 ? `%${digits}%` : '']
  );
  return rows.map((r) => ({
    email: r.email, name: r.name, phone: r.phone,
    address: r.address, city: r.city, postal: r.postal,
    orders: Number(r.orders) || 0
  }));
}

// That customer's purchases, newest first, with what was on each — the list you
// pick from to say "this is the one that needs a visit".
export async function ordersForServiceCall(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!hasDb() || !e) return [];
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.created_at, o.status,
            o.name, o.phone, o.address, o.city, o.postal,
            (SELECT COALESCE(json_agg(json_build_object('sku', i.sku, 'title', i.title) ORDER BY i.id), '[]'::json)
               FROM order_items i WHERE i.order_id = o.id) AS items
       FROM orders o
      WHERE lower(o.email) = $1 AND o.status NOT IN ('cancelled')
      ORDER BY o.created_at DESC
      LIMIT 25`,
    [e]
  );
  return rows.map((r) => ({
    id: r.id, orderNumber: r.order_number, status: r.status,
    date: r.created_at ? r.created_at.toISOString().slice(0, 10) : null,
    name: r.name, phone: r.phone, address: r.address, city: r.city, postal: r.postal,
    items: Array.isArray(r.items) ? r.items : []
  }));
}

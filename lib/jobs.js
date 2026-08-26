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
import { STATUS_LABELS as ORDER_STATUS_LABELS, round2, SERVICE_EMAIL } from './constants';
import { sendEmail, esc } from './email';

// Self-provision, same pattern as the rest of the app: the tables are in
// db/schema.sql for a fresh database, and this covers a deploy where the
// migration hasn't been run yet.
let _schema = null;
export function ensureJobSchema() {
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
      -- What the person who did the job is owed for it. Set by an admin after
      -- the fact, per job, because the rate varies by what the stop actually was.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_amount numeric(10,2);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_note   text;
      -- What we CHARGE the client for the job (the pay columns are what it costs
      -- us). invoice_id is what stops the same job being billed twice.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS charge_amount numeric(10,2);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS charge_note   text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_id    int;
      -- A transfer runs FROM one address TO another — five pieces out of
      -- Mississauga into Burlington is one job with two ends, and the driver
      -- needs both. Blank means the job only has a destination.
      -- A transfer has two ends and BOTH are somewhere a driver has to be let
      -- into. The pickup end had an address and nobody to ring when the door is
      -- locked, which is the whole reason a transfer goes wrong.
      -- A second person on the same stop. Two drivers sent together are ONE van
      -- doing ONE run — not two runs — so this is a second name on the job
      -- rather than a second copy of it: the order of the day, the money and
      -- the proof of delivery all stay single. Both can see it, sign it and
      -- close it out.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS driver2_id int;
      CREATE INDEX IF NOT EXISTS idx_jobs_driver2 ON jobs(driver2_id, job_date) WHERE driver2_id IS NOT NULL;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_name  text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_phone text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_address text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_city    text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_postal  text;
      CREATE INDEX IF NOT EXISTS idx_jobs_invoice ON jobs(invoice_id) WHERE invoice_id IS NOT NULL;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_in       timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_out      timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome       text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_used    text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_needed  text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_by     text;
      CREATE INDEX IF NOT EXISTS idx_jobs_ticket ON jobs(ticket_id) WHERE ticket_id IS NOT NULL;
      -- Proof of delivery captured by the driver's phone. It lives here rather
      -- than in the driver module because the BOARD reads it: if these were
      -- provisioned only when a driver first completed a stop, the board's own
      -- query would fail on a database no driver had used yet.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signature_path text;
      -- Which completion produced it. A phone that finishes a stop underground
      -- replays the upload when it finds signal; the ref is what stops the
      -- second attempt writing a second set of photos.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pod_ref text;
      CREATE TABLE IF NOT EXISTS job_photos (
        id serial PRIMARY KEY,
        job_id int NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        url text, pathname text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
      -- The batch a photo arrived in. Photos added AFTER a stop was closed out
      -- can't share the completion's pod_ref, so they carry their own: a queue
      -- that replays a batch on a flaky connection must not double the pictures.
      -- NOT unique: one batch is several rows sharing a ref. The check is
      -- "has this batch landed at all", made before any of it is written.
      -- The signed Proof of Delivery: damage answers, the per-item table the
      -- customer initials, the explanation, and the printed name. One jsonb
      -- because it is a FORM — it is read back whole, printed whole, and its
      -- shape follows the paper it replaces, not a query.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pod_form jsonb;
      ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS ref text;
      CREATE INDEX IF NOT EXISTS idx_job_photos_ref ON job_photos(job_id, ref);
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
  pickupName, pickupPhone, pickupAddress, pickupCity, pickupPostal, chargeAmount,
  jobDate, windowKey, windowStart, windowEnd,
  driverId, driver2Id, notes, items = [], shipmentType, services, appliance, issue, createdBy
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
                         created_by, created_by_name, shipment_type, ticket_id, services,
                         pickup_address, pickup_city, pickup_postal, charge_amount,
                         pickup_name, pickup_phone, driver2_id)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
               $24, $25, $26, $27, $28, $29, $30)
       RETURNING id`,
      [type, date ? 'scheduled' : 'unscheduled',
       clientId ? Number(clientId) : null, source, orderId ? Number(orderId) : null,
       clean(customerName, 160), clean(phone, 40), clean(email, 200),
       addr, clean(city, 120), clean(postal, 20),
       Number.isFinite(Number(lat)) ? Number(lat) : null,
       Number.isFinite(Number(lng)) ? Number(lng) : null,
       date, win.start, win.end, driverId ? Number(driverId) : null, clean(notes, 1000),
       author.email, author.name, shipment, ticket ? ticket.id : null, svc,
       clean(pickupAddress, 300), clean(pickupCity, 120), clean(pickupPostal, 20),
       Number.isFinite(Number(chargeAmount)) && Number(chargeAmount) >= 0 ? Number(chargeAmount) : null,
       clean(pickupName, 160), clean(pickupPhone, 40),
       driverId && driver2Id && Number(driver2Id) !== Number(driverId) ? Number(driver2Id) : null]
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
           j.job_date, j.window_start, j.window_end, j.driver_id, j.driver2_id, j.seq, j.notes,
           j.fail_reason, j.created_by_name, j.created_at,
           j.shipment_type, j.services, j.ticket_id, j.outcome, j.parts_needed,
           (j.pod_form IS NOT NULL) AS has_pod_form,
           j.time_in, j.time_out, j.pay_amount, j.charge_amount, j.invoice_id,
           j.pickup_address, j.pickup_city, j.pickup_postal, j.pickup_name, j.pickup_phone,
           t.ticket_number, t.appliance, t.issue,
           o.order_number,
           c.name AS client_name,
           COALESCE(u.name, u.email) AS driver_name,
           COALESCE(u2.name, u2.email) AS driver2_name,
           (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'description', i.description, 'sku', i.sku, 'qty', i.qty) ORDER BY i.id), '[]'::json)
              FROM job_items i WHERE i.job_id = j.id) AS items,
           -- What the driver captured at the door. Read as ids so the office can
           -- open the actual photo; proof nobody can look at is not proof.
           j.signature_path IS NOT NULL AS has_signature,
           (SELECT COALESCE(json_agg(p.id ORDER BY p.id), '[]'::json)
              FROM job_photos p WHERE p.job_id = j.id) AS photo_ids
      FROM jobs j
      LEFT JOIN clients c ON c.id = j.client_id
      LEFT JOIN users   u ON u.id = j.driver_id
      LEFT JOIN users   u2 ON u2.id = j.driver2_id
      LEFT JOIN service_tickets t ON t.id = j.ticket_id
      LEFT JOIN orders o ON o.id = j.order_id`;

  const [day, backlog, drivers, clients] = await Promise.all([
    // Cancelled stops come back with everything else and are separated below.
    // Filtering them out of the query is what made "cancel" look like "delete":
    // the card left the screen and the only trace was in job_events.
    query(`${select} WHERE j.job_date = $1
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
    orderId: r.order_id, orderNumber: r.order_number || null,
    customerName: r.customer_name, phone: r.phone, email: r.email,
    address: r.address, city: r.city, postal: r.postal,
    jobDate: r.job_date ? r.job_date.toISOString().slice(0, 10) : null,
    windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null,
    windowEnd: r.window_end ? String(r.window_end).slice(0, 5) : null,
    driverId: r.driver_id, driverName: r.driver_name, seq: r.seq,
    driver2Id: r.driver2_id || null, driver2Name: r.driver2_name || null,
    notes: r.notes, failReason: r.fail_reason, createdByName: r.created_by_name,
    clientName: r.client_name,
    shipmentType: r.shipment_type || null,
    services: Array.isArray(r.services) ? r.services : [],
    ticketId: r.ticket_id || null, ticketNumber: r.ticket_number || null,
    appliance: r.appliance || null, issue: r.issue || null,
    outcome: r.outcome || null, partsNeeded: r.parts_needed || null,
    hasPodForm: !!r.has_pod_form,
    timeIn: r.time_in ? r.time_in.toISOString() : null,
    timeOut: r.time_out ? r.time_out.toISOString() : null,
    payAmount: r.pay_amount == null ? null : Number(r.pay_amount),
    chargeAmount: r.charge_amount == null ? null : Number(r.charge_amount),
    invoiceId: r.invoice_id || null,
    pickupAddress: r.pickup_address || null, pickupCity: r.pickup_city || null,
    pickupPostal: r.pickup_postal || null,
    pickupName: r.pickup_name || null, pickupPhone: r.pickup_phone || null,
    items: Array.isArray(r.items) ? r.items : [],
    hasSignature: !!r.has_signature,
    photoIds: Array.isArray(r.photo_ids) ? r.photo_ids : []
  });

  const all = day.rows.map(shape);
  const jobs = all.filter((j) => j.status !== 'cancelled');
  const cancelled = all.filter((j) => j.status === 'cancelled');
  const unscheduled = backlog.rows.map(shape);

  // What's still owed on the Bargain Bay orders behind these stops. Read live
  // every time the board loads: the driver is collecting the balance AS IT IS
  // NOW, and a figure stamped on the job at import would be wrong the moment
  // the office takes another deposit.
  const balances = await balancesForOrders([...all, ...unscheduled].map((j) => j.orderId));
  for (const j of [...all, ...unscheduled]) {
    const b = j.orderId ? balances.get(j.orderId) : null;
    j.balanceDue = b ? b.balanceDue : 0;
    j.invoiceNumber = b ? b.invoiceNumber : null;
  }

  return { date, jobs, cancelled, unscheduled, drivers: drivers.rows, clients };
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

// Editing a job after it exists. The board could move a stop to another driver
// or another day and change nothing else — so a wrong phone number, a typo'd
// address or a customer who moved meant cancelling the job and typing it in
// again, which is exactly the dead end the Reopen button was added to kill.
//
// Only what's PASSED is written (undefined leaves a column alone), so a form
// that doesn't know about a field can never blank it.
//
// Money is deliberately not here: `charge_amount` goes through `setJobCharge`,
// which refuses to move a charge once the job has been invoiced. Type isn't here
// either — turning a delivery into a service call mid-life would orphan its
// ticket.
export async function updateJob(jobId, patch = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const id = Number(jobId);
  const { rows: cur } = await query('SELECT id, ticket_id, status FROM jobs WHERE id = $1', [id]);
  if (!cur.length) throw new Error('Job not found.');

  const addr = patch.address === undefined ? undefined : clean(patch.address, 300);
  if (addr !== undefined && !addr) throw new Error('A job needs an address — everything else can wait.');

  const win = (patch.windowStart !== undefined || patch.windowEnd !== undefined || patch.windowKey !== undefined)
    ? normalizeWindow({ windowKey: patch.windowKey, windowStart: patch.windowStart, windowEnd: patch.windowEnd })
    : null;

  const sets = [];
  const vals = [id];
  const put = (col, value) => { if (value !== undefined) { vals.push(value); sets.push(`${col} = $${vals.length}`); } };

  put('client_id', patch.clientId === undefined ? undefined : (patch.clientId ? Number(patch.clientId) : null));
  put('driver2_id', patch.driver2Id === undefined ? undefined : (patch.driver2Id ? Number(patch.driver2Id) : null));
  put('customer_name', patch.customerName === undefined ? undefined : clean(patch.customerName, 160));
  put('phone', patch.phone === undefined ? undefined : clean(patch.phone, 40));
  put('email', patch.email === undefined ? undefined : clean(patch.email, 200));
  put('address', addr);
  put('city', patch.city === undefined ? undefined : clean(patch.city, 120));
  put('postal', patch.postal === undefined ? undefined : clean(patch.postal, 20));
  put('notes', patch.notes === undefined ? undefined : clean(patch.notes, 1000));
  put('pickup_name', patch.pickupName === undefined ? undefined : clean(patch.pickupName, 160));
  put('pickup_phone', patch.pickupPhone === undefined ? undefined : clean(patch.pickupPhone, 40));
  put('pickup_address', patch.pickupAddress === undefined ? undefined : clean(patch.pickupAddress, 300));
  put('pickup_city', patch.pickupCity === undefined ? undefined : clean(patch.pickupCity, 120));
  put('pickup_postal', patch.pickupPostal === undefined ? undefined : clean(patch.pickupPostal, 20));
  put('shipment_type', patch.shipmentType === undefined
    ? undefined : (SHIPMENT_TYPES[patch.shipmentType] ? patch.shipmentType : null));
  put('services', patch.services === undefined
    ? undefined : [...new Set((Array.isArray(patch.services) ? patch.services : []).filter((k) => JOB_SERVICES[k]))]);
  // Coordinates come from the address autocomplete and belong WITH the address —
  // keeping stale ones would route the driver to where the customer used to be.
  if (addr !== undefined) {
    put('lat', Number.isFinite(Number(patch.lat)) ? Number(patch.lat) : null);
    put('lng', Number.isFinite(Number(patch.lng)) ? Number(patch.lng) : null);
  }
  if (patch.jobDate !== undefined) {
    const date = patch.jobDate === null || patch.jobDate === '' ? null : normalizeDate(patch.jobDate, 'job date');
    put('job_date', date);
    // A stop with no day is back in the pile; one that gets a day is scheduled
    // again — the same rule assignJob follows.
    sets.push(`status = CASE WHEN $${vals.length}::date IS NULL AND status = 'scheduled' THEN 'unscheduled'
                             WHEN $${vals.length}::date IS NOT NULL AND status = 'unscheduled' THEN 'scheduled'
                             ELSE status END`);
  }
  if (win) { put('window_start', win.start); put('window_end', win.end); }

  if (sets.length) {
    await query(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $1`, vals);
  }

  // Items are replaced wholesale — the form hands back the list as it should now
  // read, and diffing free text by hand would be worse than rewriting three rows.
  if (Array.isArray(patch.items)) {
    const lines = patch.items
      .map((it) => ({
        description: clean(typeof it === 'string' ? it : it?.description, 300),
        sku: clean(typeof it === 'string' ? null : it?.sku, 60),
        qty: Math.max(parseInt(typeof it === 'string' ? 1 : it?.qty, 10) || 1, 1)
      }))
      .filter((it) => it.description);
    await query('DELETE FROM job_items WHERE job_id = $1', [id]);
    for (const li of lines) {
      await query('INSERT INTO job_items (job_id, description, sku, qty) VALUES ($1,$2,$3,$4)',
        [id, li.description, li.sku, li.qty]);
    }
  }

  // The appliance and the fault live on the TICKET — the customer's problem —
  // not on the visit, so a correction has to land there or the next revisit
  // still carries the wrong one.
  if (cur[0].ticket_id && (patch.appliance !== undefined || patch.issue !== undefined)) {
    await query(
      `UPDATE service_tickets SET
         appliance = COALESCE($2, appliance),
         issue     = COALESCE($3, issue)
       WHERE id = $1`,
      [cur[0].ticket_id, clean(patch.appliance, 200), clean(patch.issue, 2000)]
    );
  }

  await withTransaction((client) => logEvent(client, id, 'edited', Object.keys(patch).join(', ').slice(0, 400), by));
  return getJob(id);
}

// ── Moving work around ───────────────────────────────────────────────────────
// Assign (or unassign) a job: driver, day, and position in that driver's run.
// Putting a job on a day is what moves it from 'unscheduled' to 'scheduled';
// clearing the day sends it back to the backlog.
export async function assignJob(jobId, { driverId, driver2Id, jobDate, seq } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const id = Number(jobId);
  const date = jobDate === null ? null : normalizeDate(jobDate, 'job date');
  const drv = driverId === null || driverId === '' ? null : Number(driverId);

  const { rows: cur } = await query('SELECT status, job_date, driver_id, driver2_id FROM jobs WHERE id = $1', [id]);
  if (!cur.length) throw new Error('Job not found.');
  if (['done', 'failed', 'cancelled'].includes(cur[0].status)) {
    throw new Error(`That stop is ${cur[0].status} — hit Reopen on the card first, then reassign it.`);
  }

  const nextDate = jobDate === undefined ? cur[0].job_date : date;
  const drv2 = driver2Id === null || driver2Id === '' ? null : Number(driver2Id);
  const nextDrv = driverId === undefined ? cur[0].driver_id : drv;
  let nextDrv2 = driver2Id === undefined ? cur[0].driver2_id : drv2;
  // The same person cannot be both people on a stop, and a second seat with
  // nobody in the first is just a driver.
  if (nextDrv2 && nextDrv2 === nextDrv) nextDrv2 = null;
  if (!nextDrv && nextDrv2) { nextDrv2 = null; }

  // seq is only written when it is actually given. It used to be set to $4
  // unconditionally, so every other thing this function does — changing the
  // driver, pairing a second one, moving the day — silently wiped the stop's
  // position in the run. Harmless when nothing was ordered; now that the board
  // numbers the day, it quietly reshuffles somebody's route.
  const keepSeq = seq === undefined;
  const { rows } = await query(
    `UPDATE jobs SET
       driver_id  = $2,
       driver2_id = $5,
       job_date   = $3,
       seq        = CASE WHEN $6 THEN seq ELSE $4 END,
       status     = CASE WHEN $3::date IS NULL THEN 'unscheduled'
                         WHEN status = 'unscheduled' THEN 'scheduled'
                         ELSE status END
     WHERE id = $1
     RETURNING id, job_number, driver_id, driver2_id, job_date, seq, status`,
    [id, nextDrv, nextDate, seq == null ? null : Number(seq), nextDrv2, keepSeq]
  );
  // ...except when the stop changes hands. A position only means something
  // inside one person's run, and carrying "4" into another driver's column puts
  // it in the middle of a route it was never part of.
  if (keepSeq && nextDrv !== cur[0].driver_id) {
    await query('UPDATE jobs SET seq = NULL WHERE id = $1', [id]);
    rows[0].seq = null;
  }
  const j = rows[0];
  await withTransaction((client) => logEvent(
    client, id, 'assigned',
    `${j.driver_id ? `driver #${j.driver_id}` : 'unassigned'}${j.driver2_id ? ` + #${j.driver2_id}` : ''}`
    + `${j.job_date ? ` · ${j.job_date.toISOString().slice(0, 10)}` : ' · no date'}`,
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
  // A stop that didn't happen is the one the office has to act on TODAY —
  // rebook it, ring the customer, send someone back. Waiting for whoever next
  // opens the board to notice is how it becomes tomorrow's angry phone call.
  if (status === 'failed') {
    emailJobFailed(id, failReason, note).catch((e) => console.error('failed-stop email failed', e.message));
  }
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

// Put a closed job back on the board. Cancelling or finishing a stop is not a
// decision anyone should need a developer to undo — a customer rings back, a
// driver taps Done on the wrong card, a cancelled delivery is rebooked for
// Thursday. assignJob already refused to touch a closed job and told people to
// "reopen it first"; there was nothing to click.
//
// Completion evidence is deliberately KEPT: times, signature, photos, the money
// recorded. Reopening says the work isn't finished, not that it never happened,
// and a re-close overwrites the times anyway.
export async function reopenJob(jobId, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const id = Number(jobId);
  const { rows: cur } = await query('SELECT status, job_date FROM jobs WHERE id = $1', [id]);
  if (!cur.length) throw new Error('Job not found.');
  if (!['done', 'failed', 'cancelled'].includes(cur[0].status)) {
    throw new Error('That job is already open.');
  }
  const { rows } = await query(
    `UPDATE jobs SET
       status       = CASE WHEN job_date IS NULL THEN 'unscheduled' ELSE 'scheduled' END,
       fail_reason  = NULL,
       completed_at = NULL
     WHERE id = $1
     RETURNING id, job_number, status, job_date, driver_id`,
    [id]
  );
  await withTransaction((client) => logEvent(client, id, 'reopened', `was ${cur[0].status}`, by));
  return rows[0];
}

// Where the office copy of a dispatch email goes. Env var first so it can be
// pointed at a shared inbox later without a deploy, then the RS Solutions
// service address — never Bargain Bay's.
const DISPATCH_INBOX = () => process.env.DISPATCH_EMAIL || SERVICE_EMAIL;

// Who hears that a stop is finished. Before this, `clients.notify_on_complete`
// was collected in the form, stored in the table, and read by nothing — the
// client company found out their delivery had happened by asking.
//
// Best-effort and always after the fact: a mail hiccup must never fail a
// completion the driver is standing in a doorway waiting on.
async function emailJobComplete(jobId) {
  const { rows } = await query(
    `SELECT j.job_number, j.type, j.customer_name, j.address, j.city, j.postal,
            j.time_in, j.time_out, j.outcome, j.parts_needed, j.signed_by, j.notes,
            o.order_number,
            c.name AS client_name, c.contact_email, c.notify_on_complete,
            t.ticket_number, t.appliance,
            COALESCE(u.name, u.email) AS driver_name,
            (SELECT count(*)::int FROM job_photos p WHERE p.job_id = j.id) AS photos
       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       LEFT JOIN orders  o ON o.id = j.order_id
       LEFT JOIN users   u ON u.id = j.driver_id
       LEFT JOIN service_tickets t ON t.id = j.ticket_id
      WHERE j.id = $1`,
    [Number(jobId)]
  );
  const j = rows[0];
  if (!j) return;

  const when = (v) => (v ? new Date(v).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
  const line = (label, value) => (value ? `<tr><td style="padding:3px 12px 3px 0;color:#6B625B">${esc(label)}</td><td style="padding:3px 0"><b>${esc(value)}</b></td></tr>` : '');
  const what = j.type === 'service_call'
    ? `Service call${j.appliance ? ` — ${j.appliance}` : ''}`
    : 'Delivery';
  const html = `
    <p>${esc(what)} <b>${esc(j.job_number)}</b> is complete.</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${line('Customer', j.customer_name)}
      ${line('Address', [j.address, j.city, j.postal].filter(Boolean).join(', '))}
      ${line('Order', j.order_number)}
      ${line('Ticket', j.ticket_number)}
      ${line('Driver', j.driver_name)}
      ${line('On site', [when(j.time_in), when(j.time_out)].filter(Boolean).join(' – '))}
      ${line('Outcome', j.outcome ? SERVICE_OUTCOMES[j.outcome] || j.outcome : null)}
      ${line('Parts still needed', j.parts_needed)}
      ${line('Signed by', j.signed_by)}
      ${line('Photos', j.photos ? String(j.photos) : null)}
      ${line('Notes', j.notes)}
    </table>`;

  const subject = `${j.job_number} complete — ${j.customer_name || what}`;
  // Dispatch is RS Solutions, so its mail lands in the RS inbox. Left to the
  // default, sendEmail falls back to NOTIFY_EMAIL — a Bargain Bay gmail — and
  // the people running the runs would never see it.
  const sends = [sendEmail({ to: DISPATCH_INBOX(), subject: `[Dispatch] ${subject}`, html, brand: 'rs_solutions' })];
  // The client company only hears about it if they asked to.
  if (j.notify_on_complete && j.contact_email) {
    sends.push(sendEmail({
      to: j.contact_email,
      subject,
      html: `<p>Hello ${esc(j.client_name || '')},</p>${html}<p>Proof of delivery is on file — reply to this email if you need it.</p>`,
      brand: 'rs_solutions'
    }));
  }
  await Promise.allSettled(sends);
}

// The other half of "tell somebody": a stop that couldn't be completed. Office
// only — the client hears from a person, not from an automated apology.
async function emailJobFailed(jobId, failReason, note) {
  const { rows } = await query(
    `SELECT j.job_number, j.customer_name, j.phone, j.address, j.city, j.postal, j.job_date,
            o.order_number, c.name AS client_name, COALESCE(u.name, u.email) AS driver_name
       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       LEFT JOIN orders  o ON o.id = j.order_id
       LEFT JOIN users   u ON u.id = j.driver_id
      WHERE j.id = $1`,
    [Number(jobId)]
  );
  const j = rows[0];
  if (!j) return;
  const why = FAIL_REASONS[failReason] || failReason || 'No reason given';
  await sendEmail({
    to: DISPATCH_INBOX(),
    subject: `[Dispatch] ${j.job_number} COULDN'T BE COMPLETED — ${why}`,
    brand: 'rs_solutions',
    html: `
      <p><b>${esc(j.job_number)}</b>${j.order_number ? ` (${esc(j.order_number)})` : ''} was not completed.</p>
      <p style="font-size:16px"><b>${esc(why)}</b>${note ? ` — ${esc(note)}` : ''}</p>
      <p>${esc(j.customer_name || '')}${j.phone ? ` · ${esc(j.phone)}` : ''}<br>
         ${esc([j.address, j.city, j.postal].filter(Boolean).join(', '))}</p>
      <p>Driver: ${esc(j.driver_name || 'unassigned')}${j.client_name ? ` · Client: ${esc(j.client_name)}` : ''}</p>
      <p>It needs rebooking — reopen it on the board and give it a new day.</p>`
  });
}

// The signed form, sanitised on the way in. Whatever the phone sends, what gets
// stored is the shape the printed POD reads back — a driver's app version can
// never widen it, and a malformed queue replay can never poison it.
export const POD_ANSWERS = { yes: 'Yes', no: 'No' };
function normalizePodForm(input) {
  let f = input;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { return null; } }
  if (!f || typeof f !== 'object') return null;
  const answer = (v) => (POD_ANSWERS[v] ? v : null);
  const out = {
    productDamageFree: answer(f.productDamageFree),
    propertyDamageFree: answer(f.propertyDamageFree),
    explanation: clean(f.explanation, 2000),
    printName: clean(f.printName, 160),
    items: (Array.isArray(f.items) ? f.items : []).slice(0, 20).map((it) => ({
      description: clean(it?.description, 300),
      make: clean(it?.make, 120),
      model: clean(it?.model, 120),
      serial: clean(it?.serial, 120),
      delivered: it?.delivered !== false,
      notes: clean(it?.notes, 300)
    })).filter((it) => it.description || it.make || it.model)
  };
  const empty = !out.productDamageFree && !out.propertyDamageFree && !out.explanation
    && !out.printName && out.items.length === 0;
  return empty ? null : JSON.stringify(out);
}

// ── Money still to collect ───────────────────────────────────────────────────
// What a customer still owes on the orders behind these jobs, live from the
// invoice ledger rather than copied onto the job — a deposit taken this morning
// has to change what the driver is told to collect this afternoon.
//
// Deliberately its own query with its own catch: the board is the day's work and
// must still render if anything about the invoice tables is off.
export async function balancesForOrders(orderIds = []) {
  const ids = [...new Set(orderIds.filter((n) => Number.isFinite(Number(n))).map(Number))];
  if (!hasDb() || !ids.length) return new Map();
  try {
    const { rows } = await query(
      `SELECT i.order_id,
              i.number,
              GREATEST(i.total - COALESCE((SELECT SUM(p.amount) FROM invoice_payments p
                                            WHERE p.invoice_id = i.id), 0), 0) AS balance
         FROM invoices i
        WHERE i.order_id = ANY($1) AND i.status IN ('open','partial')
        ORDER BY i.order_id, i.id DESC`,
      [ids]
    );
    const out = new Map();
    // One live invoice per order is the rule; if history ever left two, the
    // newest wins (ORDER BY above) rather than the two being added together.
    for (const r of rows) {
      if (out.has(r.order_id)) continue;
      out.set(r.order_id, { balanceDue: round2(Number(r.balance) || 0), invoiceNumber: r.number || null });
    }
    return out;
  } catch (e) {
    console.error('dispatch balance lookup failed', e.message);
    return new Map();
  }
}

// The live invoice behind a job, so the money the driver comes back with can be
// recorded against it from the board. Returns null when there's nothing owing —
// the caller turns that into a plain "nothing to collect" rather than an error.
export async function jobInvoiceForPayment(jobId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const { rows } = await query(
    'SELECT id, job_number, order_id, customer_name FROM jobs WHERE id = $1', [Number(jobId)]
  );
  const job = rows[0];
  if (!job) throw new Error('That job no longer exists.');
  if (!job.order_id) throw new Error(`${job.job_number} isn't a Bargain Bay order — bill it through the Billing tab.`);
  const { rows: inv } = await query(
    `SELECT i.id, i.number,
            GREATEST(i.total - COALESCE((SELECT SUM(p.amount) FROM invoice_payments p
                                          WHERE p.invoice_id = i.id), 0), 0) AS balance
       FROM invoices i
      WHERE i.order_id = $1 AND i.status IN ('open','partial')
      ORDER BY i.id DESC LIMIT 1`,
    [job.order_id]
  );
  if (!inv.length) throw new Error('Nothing is owing on that order — the invoice is already settled.');
  return {
    jobId: job.id, jobNumber: job.job_number, orderId: job.order_id,
    customerName: job.customer_name,
    invoiceId: inv[0].id, invoiceNumber: inv[0].number, balance: round2(Number(inv[0].balance) || 0)
  };
}

// A job_events line for something that happened off to the side of the job (the
// money being taken at the door). Same trail as every other status change, so
// the card's history explains itself later.
export async function noteJobEvent(jobId, event, detail, by) {
  if (!hasDb()) return;
  await query(
    'INSERT INTO job_events (job_id, event, detail, by_email, by_name) VALUES ($1,$2,$3,$4,$5)',
    [Number(jobId), String(event).slice(0, 40), clean(detail, 500),
     String(by?.email || '').trim().toLowerCase() || null, String(by?.name || '').trim() || null]
  ).catch((e) => console.error('job event write failed', e.message));
}

// ── Bargain Bay orders → the board ───────────────────────────────────────────
// Deliberately a pull, not a push: the dispatcher decides what enters the day,
// and nothing new hangs off the order-status path the storefront depends on.
// Idempotent — an order that already has a job is left alone.
//
// What counts as ready to go is every status that means the warehouse has said
// send it: confirmed, ready, and out_for_delivery. 'out_for_delivery' is in the
// list because that is what the owner reaches for when an order is loaded and
// going out today — leaving it out silently dropped those orders on the floor.
//
// Everything the pull declines to take is REPORTED, with the reason and the one
// thing to do about it. A button that can do nothing without saying why is how
// an order ends up delivered by memory.
const IMPORTABLE_ORDER_STATUSES = ['confirmed', 'ready', 'out_for_delivery'];
// How far back the pull looks. Old business that never reached the board isn't
// a problem anyone needs re-litigated every morning; anything older goes on by
// hand with "Add anyway".
const SCAN_DAYS = 60;

const ORDER_FOR_BOARD = `
    SELECT o.id, o.order_number, o.name, o.email, o.phone,
           o.address, o.city, o.postal, o.delivery_date, o.status, o.delivery_method,
           (SELECT j.job_number FROM jobs j
             WHERE j.order_id = o.id AND j.status <> 'cancelled' ORDER BY j.id LIMIT 1) AS live_job,
           (SELECT j.job_number FROM jobs j
             WHERE j.order_id = o.id ORDER BY j.id DESC LIMIT 1) AS any_job
      FROM orders o`;

// One order onto the board. Shared by the pull and by "Add anyway", which is the
// escape hatch for the cases the pull refuses on its own — a pickup order that
// does need a driver, an order whose job was cancelled, one still sitting at
// Pending payment. Nobody should have to go and edit an order to get a delivery
// onto a board they are looking at.
async function jobFromOrder(o, by) {
  const { rows: its } = await query('SELECT sku, title FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
  return createJob({
    type: 'delivery', source: 'bargain_bay', orderId: o.id,
    customerName: o.name, phone: o.phone, email: o.email,
    address: o.address, city: o.city, postal: o.postal,
    jobDate: o.delivery_date ? o.delivery_date.toISOString().slice(0, 10) : null,
    items: its.map((r) => ({ description: r.title || r.sku, sku: r.sku })),
    notes: `Bargain Bay order ${o.order_number}.`,
    createdBy: by
  });
}

export async function importReadyBargainBayOrders({ by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const { rows } = await query(
    `${ORDER_FOR_BOARD}
      WHERE o.status NOT IN ('delivered','cancelled','refunded')
        AND o.created_at > now() - make_interval(days => $1)
      ORDER BY o.created_at`,
    [SCAN_DAYS]
  );

  // Used only to word the report: a 'Pending payment' order with a deposit
  // against it is a real sale waiting on a delivery date, while one with no
  // invoice behind it is an abandoned web checkout that cancels itself.
  const liveInvoices = await balancesForOrders(rows.map((r) => r.id));

  const created = [];
  const skipped = [];
  let onBoard = 0;
  // Everything declined carries whether "Add anyway" can rescue it — the only
  // case it can't is a missing address, which is a fact nobody can click past.
  const skip = (o, reason, canForce = true, needsAddress = false) =>
    skipped.push({ order: o.order_number, reason, canForce, needsAddress });

  for (const o of rows) {
    if (o.live_job) {
      // Already on the board: reported as a count, never as a list — it is the
      // normal case and a list of it buries the orders that need a decision.
      onBoard += 1;
      continue;
    }
    if (o.any_job) {
      // Its job was cancelled. Not re-added automatically: cancelling a job is
      // how you take a stop off the board, and a pull that undoes that every
      // morning is worse than one that asks.
      skip(o, `was on the board as ${o.any_job} until that job was cancelled`);
      continue;
    }
    if (!String(o.address || '').trim()) {
      skip(o, 'no address on it (a pickup order) — Add anyway will ask you for one', true, true);
      continue;
    }
    if (o.delivery_method !== 'delivery') {
      skip(o, 'marked Pickup, not Delivery');
      continue;
    }
    if (!IMPORTABLE_ORDER_STATUSES.includes(o.status)) {
      const inv = liveInvoices.get(o.id);
      skip(o, o.status === 'pending_payment' && !inv
        ? 'an unpaid web checkout — it cancels itself if the money never lands'
        : `still ${ORDER_STATUS_LABELS[o.status] || o.status}${inv ? ` (deposit taken, ${inv.invoiceNumber || 'invoice'} still owing)` : ''}`);
      continue;
    }
    try {
      const job = await jobFromOrder(o, by);
      created.push({ order: o.order_number, job: job.jobNumber });
    } catch (e) {
      console.error('import BB order to dispatch failed', o.order_number, e.message);
      skip(o, e.message || 'could not be added', false);
    }
  }
  return {
    imported: created.length,
    created,
    alreadyOnBoard: onBoard,
    skipped: skipped.slice(0, 25),
    scannedDays: SCAN_DAYS
  };
}

// "Add anyway" — put one named order on the board whatever the pull thought of
// it. Everything is overridable except an address (there is nowhere to drive to)
// and a stop that is already live on the board (that would be a duplicate).
export async function importOneBargainBayOrder(orderNumber, { by, address, city, postal } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const num = String(orderNumber || '').trim();
  if (!num) throw new Error('Which order?');
  const { rows } = await query(`${ORDER_FOR_BOARD} WHERE upper(o.order_number) = upper($1)`, [num]);
  const o = rows[0];
  if (!o) throw new Error(`No order called ${num}. Check the number — it looks like BB-1179.`);
  if (o.live_job) throw new Error(`${o.order_number} is already on the board as ${o.live_job}.`);
  // A pickup order has no delivery address on it, and that is the one thing a
  // job cannot be invented without — so the caller can supply it here instead of
  // being sent off to edit the order. It goes on the JOB, not back onto the
  // order: the customer still bought it as a pickup, we are just driving it.
  const addr = String(address || '').trim() || String(o.address || '').trim();
  if (!addr) throw new Error(`${o.order_number} has no address on it — give one to put it on the board.`);
  const job = await jobFromOrder(
    { ...o,
      address: addr,
      city: String(city || '').trim() || o.city,
      postal: String(postal || '').trim() || o.postal },
    by
  );
  return { imported: 1, created: [{ order: o.order_number, job: job.jobNumber }], alreadyOnBoard: 0, skipped: [] };
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
export async function completeJob(jobId, {
  timeIn, timeOut, outcome, partsUsed, partsNeeded, signedBy, note, podForm
} = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const id = Number(jobId);

  const { rows: cur } = await query('SELECT id, job_number, type, ticket_id FROM jobs WHERE id = $1', [id]);
  if (!cur.length) throw new Error('Job not found.');
  const isService = cur[0].type === 'service_call';
  // Only a service call has to say how it ended — a delivery either happened or
  // it didn't, and "couldn't complete" already covers the second case.
  if (isService && !SERVICE_OUTCOMES[outcome]) throw new Error('Pick how the visit ended.');

  const { rows } = await query(
    `UPDATE jobs SET
       status       = 'done',
       outcome      = $2,
       parts_used   = $3,
       parts_needed = $4,
       signed_by    = $5,
       time_in      = COALESCE($6::timestamptz, time_in, now()),
       time_out     = COALESCE($7::timestamptz, now()),
       completed_at = COALESCE(completed_at, now()),
       -- COALESCE, not overwrite: a replayed completion off the offline queue
       -- must not blank a form somebody already signed.
       pod_form     = COALESCE($8::jsonb, pod_form)
     WHERE id = $1
     RETURNING id, job_number, ticket_id, outcome`,
    [id, isService ? outcome : null, clean(partsUsed, 1000), clean(partsNeeded, 1000), clean(signedBy, 160),
     timeIn || null, timeOut || null, normalizePodForm(podForm)]
  );

  const next = isService ? OUTCOME_TO_TICKET[outcome] : null;
  if (rows[0].ticket_id && next) {
    await query(
      `UPDATE service_tickets SET status = $2,
              closed_at = CASE WHEN $2 = 'resolved' THEN COALESCE(closed_at, now()) ELSE NULL END
        WHERE id = $1 AND status NOT IN ('closed','cancelled')`,
      [rows[0].ticket_id, next]
    );
  }
  // Tell the office, and the client if they asked. After the write, never in
  // front of it.
  emailJobComplete(id).catch((e) => console.error('job completion email failed', e.message));

  await withTransaction((client) => logEvent(
    client, id, isService ? 'service_complete' : 'done',
    [isService ? SERVICE_OUTCOMES[outcome] : 'Completed',
     partsUsed ? `parts used: ${partsUsed}` : null,
     partsNeeded ? `parts needed: ${partsNeeded}` : null,
     signedBy ? `signed by ${signedBy}` : null,
     note || null].filter(Boolean).join(' · '),
    by
  ));
  return rows[0];
}

// Kept so existing callers keep working — a service visit is just a job closing.
export const completeServiceVisit = completeJob;

// What the person who did the job is owed for it. Deliberately per job and set
// after the fact: the rate depends on what the stop actually turned out to be,
// and guessing it up front is how the number stops being trusted.
export async function setJobPay(jobId, { amount, note } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const amt = amount === null || amount === '' ? null : Number(amount);
  if (amt !== null && (!Number.isFinite(amt) || amt < 0)) {
    throw new Error('Pay has to be a positive dollar amount (or blank to clear it).');
  }
  const { rows } = await query(
    'UPDATE jobs SET pay_amount = $2, pay_note = $3 WHERE id = $1 RETURNING id, job_number, pay_amount',
    [Number(jobId), amt, clean(note, 300)]
  );
  if (!rows.length) throw new Error('Job not found.');
  await withTransaction((client) => logEvent(
    client, Number(jobId), 'pay_set',
    amt === null ? 'pay cleared' : `$${amt.toFixed(2)}${note ? ` — ${note}` : ''}`, by
  ));
  return rows[0];
}

// What each person is owed over a period. Counts COMPLETED work only — a job
// that didn't happen isn't owed, and one still on the board isn't finished.
// `hours` is time actually on site, from the time in/out recorded at close-out.
export async function payReport({ from, to } = {}) {
  if (!hasDb()) return { rows: [], from, to, total: 0, unpriced: 0 };
  await ensureJobSchema();
  const start = normalizeDate(from, 'start date') || torontoToday();
  const end = normalizeDate(to, 'end date') || start;

  const { rows } = await query(
    `SELECT COALESCE(NULLIF(u.name,''), u.email, 'Unassigned') AS worker,
            u.id AS driver_id,
            COUNT(*)::int                                             AS jobs,
            COUNT(*) FILTER (WHERE j.type = 'service_call')::int      AS service_calls,
            COUNT(*) FILTER (WHERE j.pay_amount IS NULL)::int         AS unpriced,
            COALESCE(SUM(j.pay_amount), 0)                            AS owed,
            COALESCE(SUM(EXTRACT(EPOCH FROM (j.time_out - j.time_in)) / 3600.0)
                     FILTER (WHERE j.time_in IS NOT NULL AND j.time_out IS NOT NULL), 0) AS hours
       FROM jobs j
       LEFT JOIN users u ON u.id = j.driver_id
      WHERE j.status = 'done'
        AND j.job_date BETWEEN $1::date AND $2::date
      GROUP BY 1, 2
      ORDER BY owed DESC, worker`,
    [start, end]
  );

  const out = rows.map((r) => ({
    driverId: r.driver_id, worker: r.worker,
    jobs: r.jobs, serviceCalls: r.service_calls, unpriced: r.unpriced,
    owed: Number(r.owed) || 0,
    hours: Math.round((Number(r.hours) || 0) * 100) / 100
  }));
  return {
    from: start, to: end, rows: out,
    total: out.reduce((a, r) => a + r.owed, 0),
    unpriced: out.reduce((a, r) => a + r.unpriced, 0)
  };
}

// Book another visit on an open ticket. One click from the ticket queue: it
// copies the customer, address and appliance across and drops the new visit in
// "To assign" so it can be put on a day. This is what stops a second trip
// opening a SECOND ticket and inflating the open-call count.
export async function bookRevisit(ticketId, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const t = await getTicket(ticketId);
  if (!t) throw new Error('Ticket not found.');
  if (['closed', 'cancelled'].includes(t.status)) {
    throw new Error(`${t.ticket_number} is ${t.status} — reopen it before booking another visit.`);
  }
  const job = await createJob({
    type: 'service_call', ticketId: t.id, clientId: t.client_id,
    source: t.order_id ? 'bargain_bay' : 'manual', orderId: t.order_id,
    customerName: t.customer_name, phone: t.phone, email: t.email,
    address: t.address, city: t.city, postal: t.postal,
    appliance: t.appliance, issue: t.issue,
    notes: `Revisit on ${t.ticket_number}.`,
    createdBy: by
  });
  return { ...job, ticketNumber: t.ticket_number };
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

// ── Billing the client ───────────────────────────────────────────────────────
// Two sides of the same job: pay_amount is what it costs us, charge_amount is
// what the client pays us. Both live on the job so the margin on a run is
// visible while it's still fresh, instead of being reconstructed at month end.
export async function setJobCharge(jobId, { amount, note } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const amt = amount === null || amount === '' ? null : Number(amount);
  if (amt !== null && (!Number.isFinite(amt) || amt < 0)) {
    throw new Error('The charge has to be a positive dollar amount (or blank to clear it).');
  }
  const { rows: cur } = await query('SELECT invoice_id FROM jobs WHERE id = $1', [Number(jobId)]);
  if (!cur.length) throw new Error('Job not found.');
  // Once it's on an invoice the number is the customer's, not ours to move.
  if (cur[0].invoice_id) throw new Error('That job is already on an invoice — credit the invoice instead of changing the charge.');

  const { rows } = await query(
    'UPDATE jobs SET charge_amount = $2, charge_note = $3 WHERE id = $1 RETURNING id, job_number, charge_amount',
    [Number(jobId), amt, clean(note, 300)]
  );
  await withTransaction((client) => logEvent(
    client, Number(jobId), 'charge_set',
    amt === null ? 'charge cleared' : `$${amt.toFixed(2)}${note ? ` — ${note}` : ''}`, by
  ));
  return rows[0];
}

// What each client owes for work finished but not yet billed. This is the whole
// point of the exercise: at the end of the week, one row per client, one button.
export async function billingSummary({ from, to } = {}) {
  if (!hasDb()) return { clients: [], from, to };
  await ensureJobSchema();
  const start = normalizeDate(from, 'start date') || torontoToday();
  const end = normalizeDate(to, 'end date') || start;

  const { rows } = await query(
    `SELECT c.id AS client_id, c.name AS client_name, c.contact_email,
            COUNT(*)::int                                       AS jobs,
            COUNT(*) FILTER (WHERE j.charge_amount IS NULL)::int AS unpriced,
            COALESCE(SUM(j.charge_amount), 0)                    AS charged,
            COALESCE(SUM(j.pay_amount), 0)                       AS cost
       FROM jobs j
       JOIN clients c ON c.id = j.client_id
      WHERE j.status = 'done'
        AND j.invoice_id IS NULL
        AND j.job_date BETWEEN $1::date AND $2::date
      GROUP BY c.id, c.name, c.contact_email
      ORDER BY charged DESC, c.name`,
    [start, end]
  );

  // The jobs behind each client's total, so the screen can show what's going on
  // the invoice before it's raised.
  const { rows: jobs } = await query(
    `SELECT j.id, j.job_number, j.client_id, j.job_date, j.type,
            j.customer_name, j.address, j.city, j.pickup_address, j.pickup_city,
            j.charge_amount, j.charge_note, j.pay_amount
       FROM jobs j
      WHERE j.status = 'done' AND j.invoice_id IS NULL AND j.client_id IS NOT NULL
        AND j.job_date BETWEEN $1::date AND $2::date
      ORDER BY j.job_date, j.id`,
    [start, end]
  );

  return {
    from: start, to: end,
    clients: rows.map((r) => ({
      clientId: r.client_id, clientName: r.client_name, contactEmail: r.contact_email,
      jobs: r.jobs, unpriced: r.unpriced,
      charged: Number(r.charged) || 0,
      cost: Number(r.cost) || 0,
      margin: (Number(r.charged) || 0) - (Number(r.cost) || 0),
      lines: jobs.filter((j) => j.client_id === r.client_id).map((j) => ({
        id: j.id, jobNumber: j.job_number,
        date: j.job_date ? j.job_date.toISOString().slice(0, 10) : null,
        type: j.type, customerName: j.customer_name,
        from: [j.pickup_address, j.pickup_city].filter(Boolean).join(', ') || null,
        to: [j.address, j.city].filter(Boolean).join(', ') || null,
        charge: j.charge_amount == null ? null : Number(j.charge_amount),
        chargeNote: j.charge_note
      }))
    }))
  };
}

// One line per job, in words the client will recognise on the invoice.
function jobInvoiceLine(j) {
  const where = j.from && j.to ? `${j.from} → ${j.to}` : (j.to || j.from || '');
  const what = j.chargeNote || (j.type === 'service_call' ? 'Service call' : 'Delivery');
  return [j.date, what, where].filter(Boolean).join(' · ');
}

// Raise the week's invoice for one client: a line per finished job, then stamp
// those jobs so they can never be billed twice. The invoice goes through the
// normal invoice path, so it lands in the invoice list, books revenue on its
// date and can be sent, edited, part-paid and refunded like any other.
export async function invoiceClientJobs(clientId, { from, to, addHst = true, sendEmail = false } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureJobSchema();
  const { createAndSendInvoice } = await import('./invoices');

  const summary = await billingSummary({ from, to });
  const client = summary.clients.find((c) => String(c.clientId) === String(clientId));
  if (!client) throw new Error('Nothing to bill that client for in this period.');
  if (!client.contactEmail) {
    throw new Error(`${client.clientName} has no contact email — add one under Clients & drivers, then invoice them.`);
  }
  const billable = client.lines.filter((l) => l.charge != null && l.charge > 0);
  if (!billable.length) {
    throw new Error(`None of ${client.clientName}'s finished jobs have a charge on them yet.`);
  }

  const invoice = await createAndSendInvoice({
    name: client.clientName,
    email: client.contactEmail,
    items: billable.map((l) => ({ description: jobInvoiceLine(l), amount: l.charge, kind: 'service' })),
    addHst: !!addHst,
    memo: `Services ${summary.from} to ${summary.to}.`,
    deliveryMethod: 'pickup',
    sendEmail: !!sendEmail,
    // Dispatch clients are RS SOLUTIONS clients. The invoice, the email it goes
    // out in, and the page they land on all carry that name — a Transource
    // invoice arriving from "Bargain Bay" is wrong in a way they notice.
    brand: 'rs_solutions',
    createdBy: by
  });

  // Stamp them only after the invoice exists — a job marked billed against an
  // invoice that failed to save would silently vanish from the next week's run.
  await query('UPDATE jobs SET invoice_id = $2 WHERE id = ANY($1)', [billable.map((l) => l.id), invoice.id]);
  await withTransaction(async (c) => {
    for (const l of billable) await logEvent(c, l.id, 'invoiced', `${invoice.number} · $${l.charge.toFixed(2)}`, by);
  });

  return {
    invoiceNumber: invoice.number, invoiceId: invoice.id, total: invoice.total,
    jobs: billable.length, client: client.clientName, hostedUrl: invoice.hostedUrl
  };
}

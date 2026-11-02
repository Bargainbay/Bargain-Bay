// What a client company (Canadian Discount Appliances et al.) can see about the
// work we ran for THEM: each stop, when we were on site, the signed proof of
// delivery, and the photos taken at the door.
//
// Access is a private link, not a login. The token is an HMAC of the client's id
// (lib/links.js), so it is derived rather than stored, cannot be guessed from the
// sequential id, and revoking it means changing AUTH_SECRET or the 'client' salt.
// Every query here is scoped to the client the token proves — a link for one
// company cannot be edited into another's by changing a number in the URL.
//
// What it deliberately NEVER returns: pay_amount (what the driver is owed),
// job_events (internal history, who changed what), order notes, and the profit
// side of anything. Notes ARE returned, but only the client's own notes column.
import { hasDb, query } from './db';
import { linkToken, verifyLinkToken } from './links';
import { ensureJobSchema, createJob, JOB_TYPES, JOB_STATUSES, JOB_SERVICES, FAIL_REASONS } from './jobs';
import { jobLineDescription } from './invoice-job-line';
import { sendEmail, esc } from './email';
import { dispatchDesk, torontoToday } from './constants';

export const clientPortalPath = (clientId) => `/client/${Number(clientId)}?t=${linkToken('client', String(clientId))}`;
export const verifyClientToken = (clientId, token) => verifyLinkToken('client', String(Number(clientId)), token);

const iso = (d) => (d ? new Date(d).toISOString() : null);
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function shape(r) {
  const minutes = r.time_in && r.time_out ? Math.round((new Date(r.time_out) - new Date(r.time_in)) / 60000) : null;
  const form = r.pod_form || null;
  return {
    id: r.id,
    jobNumber: r.job_number,
    orderNumber: r.order_number || null,
    type: r.type, typeLabel: JOB_TYPES[r.type] || r.type,
    status: r.status,
    statusLabel: r.status === 'unscheduled' ? 'Requested — awaiting scheduling' : (JOB_STATUSES[r.status] || r.status),
    failReason: r.fail_reason ? (FAIL_REASONS[r.fail_reason] || r.fail_reason) : null,
    date: dateOnly(r.job_date),
    windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null,
    windowEnd: r.window_end ? String(r.window_end).slice(0, 5) : null,
    customerName: r.customer_name, phone: r.phone,
    address: [r.address, r.city, r.postal].filter(Boolean).join(', '),
    pickup: [r.pickup_company, r.pickup_address, r.pickup_city].filter(Boolean).join(', ') || null,
    services: (Array.isArray(r.services) ? r.services : []).map((k) => JOB_SERVICES[k] || k),
    shipmentType: r.shipment_type || null,
    notes: r.notes || null,
    chargeNote: r.charge_note || null,
    requestedByClient: r.source === 'client_portal',
    createdAt: iso(r.created_at),
    driverName: r.driver_name || null, driver2Name: r.driver2_name || null,
    leftAt: iso(r.started_at), arrivedAt: iso(r.arrived_at), completedAt: iso(r.completed_at),
    timeIn: iso(r.time_in), timeOut: iso(r.time_out), minutesOnSite: minutes != null && minutes >= 0 ? minutes : null,
    signedBy: r.signed_by || null,
    hasSignature: !!r.signature_path,
    hasPod: !!form || !!r.signature_path,
    podForm: form,
    photoIds: Array.isArray(r.photo_ids) ? r.photo_ids : [],
    items: Array.isArray(r.items) ? r.items : [],
    invoiceNumber: r.invoice_number || null
  };
}

const SELECT = `
  SELECT j.id, j.client_id, j.job_number, j.type, j.status, j.source, j.created_at, j.charge_note, j.fail_reason, j.job_date, j.window_start, j.window_end,
         j.customer_name, j.phone, j.address, j.city, j.postal,
         j.pickup_company, j.pickup_address, j.pickup_city, j.services, j.shipment_type, j.notes,
         j.started_at, j.arrived_at, j.completed_at, j.time_in, j.time_out,
         j.signed_by, j.signature_path, j.pod_form,
         o.order_number,
         COALESCE(u.name, u.email) AS driver_name, COALESCE(u2.name, u2.email) AS driver2_name,
         inv.number AS invoice_number,
         (SELECT COALESCE(json_agg(p.id ORDER BY p.id), '[]'::json) FROM job_photos p WHERE p.job_id = j.id) AS photo_ids,
         (SELECT COALESCE(json_agg(json_build_object('description', i.description, 'sku', i.sku, 'qty', i.qty, 'delivered', i.delivered) ORDER BY i.id), '[]'::json)
            FROM job_items i WHERE i.job_id = j.id) AS items
    FROM jobs j
    LEFT JOIN orders o   ON o.id = j.order_id
    LEFT JOIN users  u   ON u.id = j.driver_id
    LEFT JOIN users  u2  ON u2.id = j.driver2_id
    LEFT JOIN invoices inv ON inv.id = j.invoice_id`;

export async function getClientForPortal(clientId) {
  if (!hasDb()) return null;
  await ensureJobSchema();
  const { rows } = await query('SELECT id, name, contact_name FROM clients WHERE id = $1 AND active = true', [Number(clientId)]);
  return rows[0] || null;
}

// from/to are YYYY-MM-DD, status one of JOB_STATUSES or '' for all, q free text.
export async function listClientJobs(clientId, { from, to, status, q, limit = 300 } = {}) {
  if (!hasDb()) return [];
  await ensureJobSchema();
  const args = [Number(clientId)];
  // A cancelled stop is how we take a wrong or duplicate entry OFF the board; the
  // client has no use for seeing our clean-up, so it is not listed for them.
  const where = ['j.client_id = $1', "j.type <> 'return_to_base'", "j.status <> 'cancelled'"];
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  if (ok(from)) { args.push(from); where.push(`j.job_date >= $${args.length}::date`); }
  if (ok(to)) { args.push(to); where.push(`j.job_date <= $${args.length}::date`); }
  if (status && JOB_STATUSES[status]) { args.push(status); where.push(`j.status = $${args.length}`); }
  const term = String(q || '').trim().slice(0, 80);
  if (term) {
    args.push(`%${term}%`);
    const n = args.length;
    where.push(`(j.customer_name ILIKE $${n} OR j.address ILIKE $${n} OR j.city ILIKE $${n} OR j.job_number ILIKE $${n}
                 OR j.phone ILIKE $${n} OR j.postal ILIKE $${n}
                 OR EXISTS (SELECT 1 FROM job_items i WHERE i.job_id = j.id AND i.description ILIKE $${n}))`);
  }
  const { rows } = await query(
    `${SELECT} WHERE ${where.join(' AND ')}
      ORDER BY j.job_date DESC NULLS LAST, j.id DESC LIMIT ${Math.min(Number(limit) || 300, 500)}`,
    args
  );
  return rows.map(shape);
}

export async function getClientJob(clientId, jobId) {
  if (!hasDb()) return null;
  await ensureJobSchema();
  const { rows } = await query(`${SELECT} WHERE j.client_id = $1 AND j.id = $2`, [Number(clientId), Number(jobId)]);
  return rows[0] ? shape(rows[0]) : null;
}

// Blob paths, scoped to the client: a photo id from another company's stop
// returns nothing, which is the whole access check for the proxy route.
export async function clientPhotoPath(clientId, photoId) {
  if (!hasDb()) return null;
  const { rows } = await query(
    `SELECT p.pathname FROM job_photos p JOIN jobs j ON j.id = p.job_id WHERE p.id = $1 AND j.client_id = $2`,
    [Number(photoId), Number(clientId)]
  );
  return rows[0]?.pathname || null;
}

export async function clientSignaturePath(clientId, jobId) {
  if (!hasDb()) return null;
  const { rows } = await query('SELECT signature_path FROM jobs WHERE id = $1 AND client_id = $2', [Number(jobId), Number(clientId)]);
  return rows[0]?.signature_path || null;
}

export function summarize(jobs) {
  const done = jobs.filter((j) => j.status === 'done');
  const mins = done.map((j) => j.minutesOnSite).filter((m) => m != null);
  return {
    total: jobs.length,
    delivered: done.length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    upcoming: jobs.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length,
    withPod: done.filter((j) => j.hasPod).length,
    avgMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null
  };
}

export function fmtMinutes(m) {
  if (m == null) return null;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// ── Invoice lines -> the stop behind each ─────────────────────────────────────
// A client's invoice line is clickable: it opens that stop's proof of delivery.
// The link is found by reading the line back the way it was written
// (lib/invoice-job-line.js) against the stops that invoice billed, so nothing
// extra is stored on invoice_items — an edited invoice that keeps a line's text
// keeps its link. Two identical lines pair off in order.
export async function jobsForInvoice(invoiceId) {
  if (!hasDb()) return { clientId: null, byDescription: new Map() };
  await ensureJobSchema();
  const { rows } = await query(`${SELECT} WHERE j.invoice_id = $1 ORDER BY j.job_date, j.id`, [Number(invoiceId)]);
  const byDescription = new Map();
  let clientId = null;
  for (const r of rows) {
    const j = shape(r);
    if (r.client_id) clientId = r.client_id;
    const key = jobLineDescription({
      ref: j.orderNumber || j.jobNumber, customer: j.customerName,
      kind: j.type === 'service_call' ? 'Service call' : j.type === 'pickup' ? 'Pickup' : 'Delivery',
      services: j.services, note: j.chargeNote
    });
    const list = byDescription.get(key) || [];
    list.push(j.id);
    byDescription.set(key, list);
  }
  return { clientId, byDescription };
}

// Pop the next stop id for a line's description, or null.
export const takeJobFor = (map, description) => {
  const list = map.get(String(description || '').trim());
  return list && list.length ? list.shift() : null;
};

// ── A client adds their own deliveries ───────────────────────────────────────
// The link already proves which company is asking. A request lands as an
// UNSCHEDULED stop on the board's To-assign list, tagged source 'client_portal'
// — nothing is promised, nobody is dispatched, and no price is set. Staff assign
// a driver and a day and put the charge on; the client then sees the stop move
// through the same statuses as any other.
export const CLIENT_SERVICES = ['delivery_only', 'install', 'haul_away', 'door_removal', 'exchange', 'return_pickup'];
const MAX_REQUESTS_PER_HOUR = 60;

export async function createClientRequest(clientId, body = {}) {
  const client = await getClientForPortal(clientId);
  if (!client) throw new Error('This account is not active.');
  const str = (v, n) => String(v || '').trim().slice(0, n);

  const customerName = str(body.customerName, 160);
  const phone = str(body.phone, 40);
  const address = str(body.address, 300);
  const email = str(body.email, 200);
  if (!customerName) throw new Error("Add the customer's name.");
  if (!phone) throw new Error("Add the customer's phone number so the driver can reach them.");
  if (!address) throw new Error('Add the delivery address.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That customer email does not look right.');

  const items = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({ description: str(it?.description, 300), qty: Math.min(Math.max(parseInt(it?.qty, 10) || 1, 1), 50) }))
    .filter((it) => it.description).slice(0, 30);
  if (!items.length) throw new Error('List at least one unit for the delivery.');

  const services = [...new Set((Array.isArray(body.services) ? body.services : []).filter((k) => CLIENT_SERVICES.includes(k)))];
  if (!services.length) services.push('delivery_only');

  let jobDate = null;
  if (body.preferredDate) {
    const d = String(body.preferredDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('That date does not look right.');
    if (d < torontoToday()) throw new Error('The date has already passed.');
    // A preferred day is a REQUEST. It goes in the notes, never on the stop's
    // date, or it would sit on the board as scheduled with nobody assigned.
    body = { ...body, notes: `Preferred date: ${d}.${body.notes ? ' ' + String(body.notes) : ''}` };
  }

  // Counted from rows, so one click-happy browser (or a leaked link) cannot bury
  // the board — it is also the cap on how much a stolen link could ever add.
  const { rows: recent } = await query(
    `SELECT count(*)::int AS n FROM jobs WHERE client_id = $1 AND source = 'client_portal' AND created_at > now() - interval '1 hour'`,
    [Number(clientId)]
  );
  if ((recent[0]?.n || 0) >= MAX_REQUESTS_PER_HOUR) throw new Error('That is a lot of requests in an hour. Please call or email dispatch.');

  const res = await createJob({
    type: 'delivery', clientId, source: 'client_portal',
    customerName, phone, email, address, city: str(body.city, 120), postal: str(body.postal, 20),
    jobDate, notes: str(body.notes, 1000), items, services,
    createdBy: { email: client.contact_email || null, name: `${client.name} (client portal)` }
  });

  // Tell the desk. Awaited and caught: a mail hiccup must never lose the request.
  try {
    await sendEmail({
      to: dispatchDesk(), brand: 'rs_solutions',
      subject: `New delivery request from ${client.name} — ${customerName}`,
      html: `<p><b>${esc(client.name)}</b> added a delivery on the client portal.</p>
        <p>${esc(customerName)} · ${esc(phone)}<br>${esc(address)}${body.city ? ', ' + esc(str(body.city, 120)) : ''}</p>
        <p>${items.map((i) => `${i.qty}× ${esc(i.description)}`).join('<br>')}</p>
        <p>Services: ${services.map((k) => esc(JOB_SERVICES[k] || k)).join(', ')}</p>
        ${body.notes ? `<p>Notes: ${esc(str(body.notes, 1000))}</p>` : ''}
        <p>It is on the dispatch board under <b>To assign</b>. Assign a driver and a day, then set the charge.</p>`
    });
  } catch (e) { console.error('client request email failed', e.message); }
  return res;
}

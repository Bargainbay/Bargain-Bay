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
import { ensureJobSchema, JOB_TYPES, JOB_STATUSES, JOB_SERVICES, FAIL_REASONS } from './jobs';

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
    status: r.status, statusLabel: JOB_STATUSES[r.status] || r.status,
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
  SELECT j.id, j.job_number, j.type, j.status, j.fail_reason, j.job_date, j.window_start, j.window_end,
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
  const where = ['j.client_id = $1', "j.type <> 'return_to_base'"];
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

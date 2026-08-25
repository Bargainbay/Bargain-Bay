// The driver's own view of dispatch: their stops, and the three things they do
// to one (start it, finish it, or report why they couldn't).
//
// Everything here is JOBS, not orders. The old /driver screen worked off orders
// and so could only ever show Bargain Bay deliveries — a service call for
// another company was invisible to the person doing it. A job carries both.
//
// Every mutation re-checks that the job is assigned to THIS driver. The gate is
// per-job and not per-session on purpose: a driver's phone stays signed in for
// months, and yesterday's link must not become a way to close somebody else's
// stop.
import { hasDb, query } from './db';
import { updateOrderStatus } from './orders';
import { markUnitsSold } from './catalog-sync';
import { sendOrderStatusEmail } from './email';
import {
  balancesForOrders, torontoToday, ensureJobSchema,
  JOB_STATUSES, FAIL_REASONS, SERVICE_OUTCOMES
} from './jobs';

// The driver tables live in ensureJobSchema (lib/jobs.js) — the board reads
// them too, so they can't be provisioned only when a driver first shows up.
const ensureDriverPodSchema = ensureJobSchema;

const iso = (d) => (d ? new Date(d).toISOString() : null);

// A driver's working list. Today's stops, plus anything still open from an
// earlier day — an unfinished stop that silently drops off the list at midnight
// is how a delivery gets forgotten for a week.
export async function driverJobs(userId, { date } = {}) {
  if (!hasDb() || !userId) return { date: date || null, stops: [] };
  await ensureDriverPodSchema();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : torontoToday();

  const { rows } = await query(
    `SELECT j.id, j.job_number, j.type, j.status, j.seq, j.job_date,
            j.window_start, j.window_end, j.customer_name, j.phone, j.email,
            j.address, j.city, j.postal, j.pickup_address, j.pickup_city, j.pickup_postal,
            j.notes, j.shipment_type, j.services, j.order_id, j.ticket_id,
            j.started_at, j.arrived_at, j.completed_at, j.time_in, j.time_out,
            j.signature_path,
            o.order_number,
            c.name AS client_name,
            t.ticket_number, t.appliance, t.issue,
            (SELECT COALESCE(json_agg(json_build_object('description', i.description, 'sku', i.sku, 'qty', i.qty) ORDER BY i.id), '[]'::json)
               FROM job_items i WHERE i.job_id = j.id) AS items,
            (SELECT count(*) FROM job_photos p WHERE p.job_id = j.id) AS photo_count
       FROM jobs j
       LEFT JOIN orders o ON o.id = j.order_id
       LEFT JOIN clients c ON c.id = j.client_id
       LEFT JOIN service_tickets t ON t.id = j.ticket_id
      WHERE j.driver_id = $1
        AND j.status <> 'cancelled'
        AND (j.job_date = $2
             OR (j.job_date < $2 AND j.status NOT IN ('done','failed')))
      ORDER BY j.job_date, j.seq NULLS LAST, j.window_start NULLS LAST, j.id`,
    [Number(userId), day]
  );

  const balances = await balancesForOrders(rows.map((r) => r.order_id));
  const stops = rows.map((r) => {
    const bal = r.order_id ? balances.get(r.order_id) : null;
    return {
      id: r.id, jobNumber: r.job_number, type: r.type, status: r.status, seq: r.seq,
      jobDate: r.job_date ? r.job_date.toISOString().slice(0, 10) : null,
      overdue: !!(r.job_date && r.job_date.toISOString().slice(0, 10) < day),
      windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null,
      windowEnd: r.window_end ? String(r.window_end).slice(0, 5) : null,
      customerName: r.customer_name, phone: r.phone,
      address: r.address, city: r.city, postal: r.postal,
      pickupAddress: r.pickup_address, pickupCity: r.pickup_city, pickupPostal: r.pickup_postal,
      notes: r.notes, shipmentType: r.shipment_type,
      services: Array.isArray(r.services) ? r.services : [],
      orderNumber: r.order_number || null, clientName: r.client_name || null,
      ticketNumber: r.ticket_number || null, appliance: r.appliance || null, issue: r.issue || null,
      items: Array.isArray(r.items) ? r.items : [],
      startedAt: iso(r.started_at), arrivedAt: iso(r.arrived_at), completedAt: iso(r.completed_at),
      timeIn: iso(r.time_in), timeOut: iso(r.time_out),
      hasSignature: !!r.signature_path, photoCount: Number(r.photo_count) || 0,
      balanceDue: bal ? bal.balanceDue : 0,
      invoiceNumber: bal ? bal.invoiceNumber : null
    };
  });
  return { date: day, stops };
}

// The gate on every driver mutation.
export async function jobBelongsToDriver(jobId, userId) {
  if (!hasDb() || !jobId || !userId) return false;
  const { rows } = await query('SELECT 1 FROM jobs WHERE id = $1 AND driver_id = $2', [Number(jobId), Number(userId)]);
  return rows.length > 0;
}

// Has this exact completion already been recorded? Answering yes to a replayed
// upload is what makes finishing a stop offline safe: the phone can send the
// same completion twice and the customer still has one set of photos.
export async function podAlreadyRecorded(jobId, ref) {
  if (!hasDb() || !ref) return false;
  await ensureDriverPodSchema();
  const { rows } = await query('SELECT 1 FROM jobs WHERE id = $1 AND pod_ref = $2', [Number(jobId), String(ref)]);
  return rows.length > 0;
}

export async function saveJobSignature(jobId, pathname, ref) {
  await ensureDriverPodSchema();
  await query('UPDATE jobs SET signature_path = $2, pod_ref = $3 WHERE id = $1', [Number(jobId), pathname, ref || null]);
}

export async function addJobPhoto(jobId, url, pathname, ref = null) {
  await ensureDriverPodSchema();
  await query(
    'INSERT INTO job_photos (job_id, url, pathname, ref) VALUES ($1,$2,$3,$4)',
    [Number(jobId), url, pathname, ref || null]
  );
}

// Has this batch of photos already landed? Asked BEFORE any of it is written,
// because one batch is several rows and a half-written replay is worse than a
// refused one. Photos added after close-out carry their own ref rather than the
// completion's pod_ref — the stop can be added to more than once.
export async function photoBatchRecorded(jobId, ref) {
  if (!hasDb() || !ref) return false;
  await ensureDriverPodSchema();
  const { rows } = await query(
    'SELECT 1 FROM job_photos WHERE job_id = $1 AND ref = $2 LIMIT 1', [Number(jobId), String(ref)]
  );
  return rows.length > 0;
}

// How many pictures a stop has now — what the driver's card counts back to them
// after a late addition.
export async function jobPhotoCount(jobId) {
  if (!hasDb()) return 0;
  await ensureDriverPodSchema();
  const { rows } = await query('SELECT count(*)::int AS n FROM job_photos WHERE job_id = $1', [Number(jobId)]);
  return rows[0]?.n || 0;
}

// A Bargain Bay delivery that's been done is a DELIVERED ORDER as far as the
// customer, their order page and the storefront are concerned. The job records
// the visit; this keeps the order side saying the same thing, exactly as the old
// order-based driver screen did.
//
// Best-effort throughout: the driver's completion is already saved, and none of
// this is allowed to fail it. A stop with no order behind it (a service call for
// another company) simply has nothing to do here.
export async function markOrderDeliveredForJob(jobId) {
  if (!hasDb()) return null;
  try {
    const { rows } = await query(
      `SELECT o.id, o.status FROM jobs j JOIN orders o ON o.id = j.order_id WHERE j.id = $1`,
      [Number(jobId)]
    );
    const order = rows[0];
    if (!order) return null;
    // Already finished, or called off — leave it alone. Note that a deposit sale
    // still sitting in 'pending_payment' IS moved: the goods physically left, and
    // markInvoicePaid only ever promotes pending_payment/confirmed, so settling
    // the balance later can't drag the order backwards.
    if (['delivered', 'cancelled', 'refunded'].includes(order.status)) return null;

    const updated = await updateOrderStatus(order.id, 'delivered');
    await query('UPDATE orders SET delivered_at = now() WHERE id = $1', [order.id]).catch(() => {});
    const { rows: items } = await query('SELECT sku, title, price FROM order_items WHERE order_id = $1', [order.id]);
    try {
      const prices = Object.fromEntries(items.map((r) => [r.sku, Number(r.price) || null]));
      await markUnitsSold(items.map((r) => r.sku), { channel: 'order', ref: updated?.order_number, prices });
    } catch (e) { console.error('markUnitsSold (driver job) failed', e.message); }
    if (updated) {
      sendOrderStatusEmail({ ...updated, status: 'delivered' }, items.map((r) => ({ title: r.title, price: Number(r.price) })))
        .catch((e) => console.error('delivered email failed', e.message));
    }
    return updated;
  } catch (e) {
    console.error('order delivered from job failed', e.message);
    return null;
  }
}

export async function jobPhotoPath(id) {
  if (!hasDb()) return null;
  await ensureDriverPodSchema();
  const { rows } = await query('SELECT pathname FROM job_photos WHERE id = $1', [Number(id)]);
  return rows[0]?.pathname || null;
}

export async function jobSignaturePath(jobId) {
  if (!hasDb()) return null;
  await ensureDriverPodSchema();
  const { rows } = await query('SELECT signature_path FROM jobs WHERE id = $1', [Number(jobId)]);
  return rows[0]?.signature_path || null;
}

export { JOB_STATUSES, FAIL_REASONS, SERVICE_OUTCOMES };

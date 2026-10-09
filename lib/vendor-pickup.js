// Lane B: the collection of a vendor-held unit. See docs/marketplace/PLAN.md §4.2.
//
// WHEN THE VENDOR MARKS A LANE B ORDER READY, a dispatch job is booked to collect the unit and bring it
// to our warehouse (type 'pickup', the vendor's dock as the pickup end of a transfer, PICKUP_ADDRESS as
// the drop). The customer's own delivery then proceeds like our own stock. Two legs, on purpose: it is
// the simplest model that works with the delivery job the pull already makes, and it lets the crew
// inspect the unit before anyone promises the customer a day. (Collecting and delivering in one trip is
// a possible later optimisation — see the open question in CLAUDE.md.)
//
// WHAT THIS DELIBERATELY DOES NOT DO
//  - It never sets jobs.order_id. The customer's order is delivered by the ordinary delivery job; a job
//    carrying order_id would make the board think that order is already on it, and completing the
//    collection would mark the CUSTOMER'S order delivered. The link is jobs.vendor_order_id.
//  - It never touches ready_by / ready_strike_id. The 72 hours are judged on the vendor marking ready,
//    not on our crew arriving.
//  - It never copies the customer's name, phone, email or address onto the job. The vendor is a third
//    party; the stop needs nothing of the customer's.
// The serial number is private: it goes onto a staff/driver surface (the job) and nowhere a vendor or
// customer can read.
import { query, withTransaction } from './db';
import { sendEmail, esc } from './email';
import { PICKUP_ADDRESS, SERVICE_EMAIL, TZ } from './constants';
import { sizeClassFor } from './marketplace-rules';
import { createJob, setJobStatus, noteJobEvent } from './jobs';
import { issueStrike, logVendorEvent } from './vendors';

const SIZE_STAFFING = {
  small: 'Small: one person.',
  standard: 'Standard: TWO people and a dolly.',
  oversize: 'OVERSIZE: two people, a dolly and straps; check the truck and the door widths before leaving.'
};

/** "1135 Squires Beach Rd, Pickering, ON L1W 3T9" -> the three fields a job keeps. */
export function warehouseDrop() {
  const [street, city, rest] = String(PICKUP_ADDRESS).split(',').map((x) => x.trim());
  return { address: street, city, postal: String(rest || '').replace(/^ON\s*/i, '') };
}

/** Today, or tomorrow once the afternoon is gone (Toronto time) — a job booked at 5pm is not for today. */
export function pickupDate(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const today = now.toLocaleDateString('en-CA', { timeZone: TZ });
  if (hour < 14) return today;
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function loadForJob(vendorOrderId) {
  const { rows } = await query(
    `SELECT vo.*, COALESCE(v.trade_name, v.legal_name) AS vendor_name,
            v.contact_name, v.contact_phone
       FROM vendor_orders vo JOIN vendors v ON v.id = vo.vendor_id WHERE vo.id = $1`, [vendorOrderId]);
  if (!rows.length) return null;
  const vo = rows[0];
  const { rows: ls } = await query(
    `SELECT l.* FROM order_items oi JOIN marketplace_listings l ON l.id = oi.listing_id
      WHERE oi.order_id = $1 AND oi.vendor_id = $2 AND l.lane = $3 ORDER BY l.id`, [vo.order_id, vo.vendor_id, vo.lane]);
  return { vo, listings: ls };
}

export function pickupNotes({ vo, listings, vendorName }) {
  const lines = [`COLLECT FROM SELLER — order ${vo.order_number}. Bring it to our warehouse; the customer delivery follows.`];
  for (const l of listings) {
    const size = sizeClassFor({ weightLb: l.weight_lb, widthIn: l.width_in, depthIn: l.depth_in, heightIn: l.height_in });
    lines.push(`${l.sku} · ${l.title || `${l.make || ''} ${l.model || ''}`.trim()}`);
    lines.push(`  CHECK AGAINST THE RATING PLATE: model ${l.model || '(none given)'} · serial ${l.serial_private || '(none given)'}.`);
    lines.push(`  Size: ${l.weight_lb ? `${l.weight_lb} lb` : 'weight not given'}, ${[l.width_in, l.depth_in, l.height_in].every(Boolean) ? `${l.width_in}x${l.depth_in}x${l.height_in} in` : 'dimensions not given'}. ${SIZE_STAFFING[size]}`);
    if (l.delivery_notes) lines.push(`  Seller's handover notes: ${l.delivery_notes}`);
  }
  lines.push('PACKING: the seller must have it clean, doors/cords secured and ready at ground level or the dock, anything over 150 lb with their people on hand to help load. Photograph the unit and the rating plate before loading. If it is badly packed or visibly damaged, photograph it and say so.');
  lines.push(`IF THE MODEL OR SERIAL DOES NOT MATCH, or the condition is worse than listed: do NOT load it. Tap "Couldn't complete" and choose "Unit does not match the listing", and say what you found.`);
  lines.push(`Seller: ${vendorName}. Do not discuss the customer with the seller.`);
  return lines.join('\n');
}

/**
 * Book the collection for a Lane B vendor order that is READY. Idempotent: a live job for the order
 * (and the partial unique index behind it) means the second call returns the first job.
 */
export async function ensurePickupJob(vendorOrderId, { by = 'system', now = new Date() } = {}) {
  const loaded = await loadForJob(Number(vendorOrderId));
  if (!loaded) return { ok: false, why: 'No such vendor order.' };
  const { vo, listings } = loaded;
  if (vo.lane !== 'B') return { ok: false, why: 'Only Lane B orders are collected by our crew.' };
  if (vo.status !== 'ready') return { ok: false, why: `The order is ${String(vo.status).replace('_', ' ')}, not ready.` };
  if (vo.collected_at) return { ok: false, why: 'Already collected.' };
  const { rows: live } = await query(`SELECT id, job_number FROM jobs WHERE vendor_order_id = $1 AND status <> 'cancelled' ORDER BY id LIMIT 1`, [vo.id]);
  if (live.length) return { ok: true, already: true, jobId: live[0].id, jobNumber: live[0].job_number };
  if (!listings.length) return { ok: false, why: 'The order has no listing to collect.' };
  const first = listings[0];
  if (!first.pickup_address) return { ok: false, why: 'The listing has no pickup address.' };
  const drop = warehouseDrop();
  let job;
  try {
    job = await createJob({
      type: 'pickup', source: 'marketplace', vendorOrderId: vo.id,
      customerName: 'Bargain Bay warehouse', address: drop.address, city: drop.city, postal: drop.postal,
      pickupCompany: vo.vendor_name, pickupName: vo.contact_name, pickupPhone: vo.contact_phone,
      pickupAddress: first.pickup_address, pickupCity: first.pickup_city, pickupPostal: first.pickup_postal,
      jobDate: pickupDate(now),
      items: listings.map((l) => ({ description: `${l.title || `${l.make || ''} ${l.model || ''}`.trim()} — model ${l.model || '?'} — serial ${l.serial_private || '?'}`, sku: l.sku })),
      notes: pickupNotes({ vo, listings, vendorName: vo.vendor_name }),
      createdBy: { email: 'system', name: 'Marketplace' }
    });
  } catch (e) {
    if (e?.code === '23505') {                              // lost a race to another caller: theirs stands
      const { rows } = await query(`SELECT id, job_number FROM jobs WHERE vendor_order_id = $1 AND status <> 'cancelled' LIMIT 1`, [vo.id]);
      if (rows.length) return { ok: true, already: true, jobId: rows[0].id, jobNumber: rows[0].job_number };
    }
    throw e;
  }
  await query('UPDATE vendor_orders SET pickup_job_id = $2 WHERE id = $1', [vo.id, job.id]);
  await query(`INSERT INTO vendor_events (vendor_id, event, actor, detail) VALUES ($1,'pickup_job_booked',$2,$3)`,
    [vo.vendor_id, by, JSON.stringify({ order: vo.order_number, job: job.jobNumber })]);
  return { ok: true, jobId: job.id, jobNumber: job.jobNumber };
}

/** Best-effort wrapper for the places that must never fail because of this. */
export async function tryEnsurePickupJob(vendorOrderId, opts) {
  try { return await ensurePickupJob(vendorOrderId, opts); }
  catch (e) { console.error('pickup job could not be booked', vendorOrderId, e?.message || e); return { ok: false, why: e?.message || String(e) }; }
}

/** Take a not-yet-collected pickup job off the board (the order was cancelled, or is no longer Lane B). */
export async function cancelPickupJob(vendorOrderId, reason, by = 'system') {
  const { rows } = await query(`SELECT id, status FROM jobs WHERE vendor_order_id = $1 AND status NOT IN ('cancelled','done') `, [vendorOrderId]);
  for (const j of rows) await setJobStatus(j.id, 'cancelled', { note: reason }, { email: by, name: by });
  return rows.length;
}

/** The customer's order was cancelled/refunded: no one should drive to collect it. */
export async function cancelPickupJobsForOrder(orderId, reason) {
  const { rows } = await query(`SELECT id FROM vendor_orders WHERE order_id = $1 AND lane = 'B' AND collected_at IS NULL`, [orderId]);
  let n = 0;
  for (const r of rows) n += await cancelPickupJob(r.id, reason);
  return n;
}

/**
 * How the stop went. Called by the dispatch functions for any job; does nothing unless the job is a
 * vendor collection. Done = the unit is ours to handle (collected_at). Failed with "does not match the
 * listing" = a not-as-described report waiting for staff.
 */
export async function onPickupJobStatus(jobId, status, { failReason, note } = {}) {
  const { rows } = await query('SELECT id, job_number, vendor_order_id FROM jobs WHERE id = $1', [Number(jobId)]);
  const job = rows[0];
  if (!job?.vendor_order_id) return;
  const { rows: vo } = await query('SELECT * FROM vendor_orders WHERE id = $1', [job.vendor_order_id]);
  if (!vo.length) return;
  const o = vo[0];
  if (status === 'done') {
    const { rows: set } = await query('UPDATE vendor_orders SET collected_at = COALESCE(collected_at, now()) WHERE id = $1 AND collected_at IS NULL RETURNING id', [o.id]);
    if (set.length) await query(`INSERT INTO vendor_events (vendor_id, event, actor, detail) VALUES ($1,'order_collected','system',$2)`, [o.vendor_id, JSON.stringify({ order: o.order_number, job: job.job_number })]);
  } else if (status === 'failed' && failReason === 'not_as_described') {
    const { rows: set } = await query(
      `UPDATE vendor_orders SET mismatch_at = COALESCE(mismatch_at, now()), mismatch_note = $2, mismatch_resolved_at = NULL, mismatch_resolution = NULL, mismatch_resolved_by = NULL
        WHERE id = $1 RETURNING id`, [o.id, String(note || '').trim().slice(0, 1000) || 'The crew reported that the unit does not match the listing.']);
    if (set.length) {
      await query(`INSERT INTO vendor_events (vendor_id, event, actor, detail) VALUES ($1,'pickup_mismatch','system',$2)`, [o.vendor_id, JSON.stringify({ order: o.order_number, job: job.job_number })]);
      try {
        await sendEmail({ to: SERVICE_EMAIL, subject: `Crew reports ${o.order_number} does not match its listing`,
          html: `<p>The crew on <b>${esc(job.job_number)}</b> would not load the unit for <b>${esc(o.order_number)}</b>: it does not match the listing.</p>
                 <p>${esc(note || '')}</p><p>Open Admin → Marketplace → Orders to decide: strike the seller (and refund the customer), or dismiss and rebook the collection.</p>` });
      } catch (e) { console.error('mismatch email failed', e?.message || e); }
    }
  }
}

/**
 * Staff decide what a not-as-described report means. 'strike' only strikes; 'strike_refund' also
 * cancels the order and refunds the customer's lines; 'dismiss' says the crew was wrong (rebook the
 * collection from the board). Always leaves a note of who decided what.
 */
export async function resolveMismatch(vendorOrderId, { action, note, by } = {}) {
  if (!['strike', 'strike_refund', 'dismiss'].includes(action)) throw new Error('Choose strike, strike and refund, or dismiss.');
  if (!by) throw new Error('Who is deciding?');
  const { rows } = await query('SELECT * FROM vendor_orders WHERE id = $1', [Number(vendorOrderId)]);
  const o = rows[0];
  if (!o) throw new Error('Order not found.');
  if (!o.mismatch_at) throw new Error('The crew has not reported a mismatch on this order.');
  if (o.mismatch_resolved_at) throw new Error('This report has already been decided.');
  const claimed = await query(`UPDATE vendor_orders SET mismatch_resolved_at = now(), mismatch_resolution = $2, mismatch_resolved_by = $3 WHERE id = $1 AND mismatch_resolved_at IS NULL RETURNING id`, [o.id, action, by]);
  if (!claimed.rows.length) throw new Error('This report has already been decided.');
  if (action === 'dismiss') {
    await withTransaction((c) => logVendorEvent((t, p) => c.query(t, p), o.vendor_id, 'pickup_mismatch_dismissed', by, { order: o.order_number, note: note || null }));
    return { ok: true };
  }
  const strike = await issueStrike(o.vendor_id, { reason: 'not_as_described', orderRef: o.order_number, note: note || o.mismatch_note || `Vendor order ${o.id}`, by });
  if (action === 'strike_refund') {
    const { staffCancelVendorOrder } = await import('./vendor-orders');
    await staffCancelVendorOrder(o.id, { reasonCode: 'not_as_described', note: note || o.mismatch_note, by });
  }
  return { ok: true, strikeId: strike.strikeId, restricted: strike.restricted };
}

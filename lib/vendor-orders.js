// A customer's order, from the vendor's side. See docs/marketplace/PLAN.md §10–§12.
//
// The customer has ONE order and ONE invoice (checkout, unchanged). Here each vendor's part of it
// becomes a vendor order that moves through:
//
//   awaiting_payment -> awaiting_accept -> accepted -> ready -> delivered      (or cancelled)
//
// THE CLOCKS START WHEN WE CONFIRM THE E-TRANSFER, not at checkout: the vendor is not told about an
// order before then, so an unpaid order can never be accepted, missed or struck. 24h to accept, 72h
// in total to be ready (tracking submitted, for Lane C). Misses are struck from SERVER timestamps.
//
// Everything that calls out to the rest of the system (a refund, a strike, an email) is best-effort
// and logged: a hiccup in the marketplace must never block an order from being confirmed or delivered.
import { query, withTransaction } from './db';
import { sendEmail, esc } from './email';
import { issueStrike, logVendorEvent } from './vendors';
import { recordOrderSettlement } from './vendor-ledger';
import { SERVICE_EMAIL, TZ } from './constants';
import {
  ACCEPT_HOURS, READY_HOURS, REMINDER_ACCEPT_HOURS, REMINDER_READY_HOUR, VENDOR_CANCEL_REASONS, CARRIERS,
  VENDOR_REFUND_REASON, sizeClassFor, insuranceCents, trackingLooksValid, planVendorOrders
} from './marketplace-rules';

const HOUR = 3600 * 1000;
const at = (v) => new Date(v);
const plusHours = (d, h) => new Date(at(d).getTime() + h * HOUR);
const when = (d) => at(d).toLocaleString('en-CA', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const asInt = (v) => Number(v ?? 0);

// --- delivery-service rates ----------------------------------------------------

export async function deliveryRates() {
  const { rows } = await query('SELECT size_class, cents FROM delivery_service_rates');
  const rates = { small: null, standard: null, oversize: null };
  for (const r of rows) rates[r.size_class] = asInt(r.cents);
  return { rates, unset: Object.keys(rates).filter((k) => rates[k] == null) };
}

export async function setDeliveryRate(sizeClass, cents, { by }) {
  if (!['small', 'standard', 'oversize'].includes(sizeClass)) throw new Error('Size class must be small, standard or oversize.');
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n < 0) throw new Error('Enter the fee in dollars, zero or more.');
  if (!by) throw new Error('Who is setting this?');
  await query(
    `INSERT INTO delivery_service_rates (size_class, cents, set_by) VALUES ($1,$2,$3)
     ON CONFLICT (size_class) DO UPDATE SET cents = EXCLUDED.cents, set_by = EXCLUDED.set_by, set_at = now()`, [sizeClass, n, by]);
  return { ok: true };
}

// --- checkout ------------------------------------------------------------------

/**
 * Inside the checkout transaction: make sure every vendor unit is STILL live (a vendor can pause or
 * withdraw between the page loading and the buyer pressing the button), then write the vendor orders
 * and stamp the order lines. Throws { code: 'SKU_HELD', sku } like the reservation lock does.
 */
export async function createVendorOrdersTx(client, { orderId, orderNumber, units, deliveryMethod, feeCents, hstCharged = true }) {
  const mp = units.filter((u) => u.marketplace);
  if (!mp.length) return { created: 0 };
  const plan = planVendorOrders(units, { deliveryMethod, feeCents });
  if (plan.errors.length) { const e = new Error(plan.errors[0]); e.code = 'NOT_PICKABLE'; throw e; }
  const skus = mp.map((u) => u.id);
  const { rows: live } = await client.query(
    `SELECT l.sku FROM marketplace_listings l JOIN vendors v ON v.id = l.vendor_id
      WHERE l.sku = ANY($1) AND l.status = 'live' AND v.status = 'approved' AND v.hst_status = 'registered'
      FOR UPDATE OF l`, [skus]);
  const stillLive = new Set(live.map((r) => r.sku));
  for (const sku of skus) if (!stillLive.has(sku)) { const e = new Error('A seller just took that unit off sale.'); e.code = 'SKU_HELD'; e.sku = sku; throw e; }
  // The HST on a seller's part is theirs to remit. If the order carried no HST at all, there is none to pass on.
  let vendorSubtotalCents = 0; let vendorHstCents = 0;
  for (const g of plan.groups) {
    const hst = hstCharged ? g.hstCents : 0;
    await client.query(
      `INSERT INTO vendor_orders (order_id, order_number, vendor_id, lane, item_cents, lane_c_delivery_cents, hst_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orderId, orderNumber, g.vendorId, g.lane, g.itemCents, g.laneCDeliveryCents, hst]);
    vendorSubtotalCents += g.itemCents + g.laneCDeliveryCents;
    vendorHstCents += hst;
  }
  // Remembered on the order so every revenue figure can leave it out (migration 0020).
  await client.query('UPDATE orders SET vendor_subtotal = $2, vendor_hst = $3 WHERE id = $1', [orderId, vendorSubtotalCents / 100, vendorHstCents / 100]);
  await client.query(
    `UPDATE order_items oi SET vendor_id = l.vendor_id, listing_id = l.id
       FROM marketplace_listings l WHERE oi.order_id = $1 AND oi.sku = l.sku AND oi.sku = ANY($2)`, [orderId, skus]);
  return { created: plan.groups.length };
}

// --- who to tell -----------------------------------------------------------------

async function vendorRecipients(vendorId) {
  const { rows: v } = await query('SELECT contact_email, COALESCE(trade_name, legal_name) AS name FROM vendors WHERE id = $1', [vendorId]);
  const { rows: u } = await query('SELECT email FROM vendor_users WHERE vendor_id = $1 AND revoked_at IS NULL', [vendorId]);
  const to = [...new Set([v[0]?.contact_email, ...u.map((r) => r.email)].filter(Boolean).map((e) => e.toLowerCase()))];
  return { to, name: v[0]?.name || 'your account' };
}
async function tellVendor(vendorId, subject, html) {
  try {
    const { to } = await vendorRecipients(vendorId);
    for (const addr of to) await sendEmail({ to: addr, subject, html });
  } catch (e) { console.error('vendor notification failed', e?.message || e); }
}
async function tellOffice(subject, html) {
  try { await sendEmail({ to: SERVICE_EMAIL, subject, html }); } catch (e) { console.error('office notification failed', e?.message || e); }
}

// --- payment confirmed: the clocks start ------------------------------------------

/**
 * We confirmed the e-transfer. Starts both clocks, takes the units off sale (sold), and tells each
 * vendor. Idempotent: only vendor orders still awaiting payment move, so confirming twice does nothing.
 */
export async function confirmVendorOrders(orderId, { now = new Date(), by = 'system' } = {}) {
  const moved = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(
      `UPDATE vendor_orders SET status = 'awaiting_accept', confirmed_at = $2,
              accept_by = $3, ready_by = $4
        WHERE order_id = $1 AND status = 'awaiting_payment'
        RETURNING id, vendor_id, order_number, lane, item_cents`,
      [orderId, now.toISOString(), plusHours(now, ACCEPT_HOURS).toISOString(), plusHours(now, READY_HOURS).toISOString()]);
    if (!rows.length) return [];
    const { rows: sold } = await q(
      `UPDATE marketplace_listings l SET status = 'sold', updated_at = now()
         FROM order_items oi WHERE oi.order_id = $1 AND oi.listing_id = l.id AND l.status = 'live' RETURNING l.id`, [orderId]);
    for (const s of sold) await q(`INSERT INTO listing_events (listing_id, event, actor, detail) VALUES ($1,'sold',$2,$3)`, [s.id, by, JSON.stringify({ order: rows[0].order_number })]);
    for (const r of rows) await logVendorEvent(q, r.vendor_id, 'order_confirmed', by, { order: r.order_number, vendorOrderId: r.id });
    return rows;
  });
  for (const r of moved) {
    await tellVendor(r.vendor_id, `New order ${r.order_number} — accept within ${ACCEPT_HOURS} hours`,
      `<p>A customer has paid for an order that includes your unit(s).</p>
       <p><b>Accept by ${esc(when(plusHours(now, ACCEPT_HOURS)))}</b> and have it ready${r.lane === 'C' ? ' (tracking submitted)' : ''} by <b>${esc(when(plusHours(now, READY_HOURS)))}</b>.
       Missing either, or cancelling, is a strike.</p>
       <p>Open your vendor portal → Orders to accept it.</p>`);
  }
  return { confirmed: moved.length };
}

// --- the vendor's actions ----------------------------------------------------------

/** A vendor's open and recent orders, with the lines on each. Scoped by the id from the session. */
export async function listVendorOrders(vendorId, { status } = {}) {
  const { rows } = await query(
    `SELECT vo.*, COALESCE(json_agg(json_build_object('sku', oi.sku, 'title', oi.title, 'price', oi.price)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM vendor_orders vo
       LEFT JOIN order_items oi ON oi.order_id = vo.order_id AND oi.vendor_id = vo.vendor_id
            AND oi.listing_id IN (SELECT id FROM marketplace_listings WHERE lane = vo.lane AND vendor_id = vo.vendor_id)
      WHERE vo.vendor_id = $1 AND vo.status <> 'awaiting_payment' AND ($2::text IS NULL OR vo.status = $2)
      GROUP BY vo.id ORDER BY vo.created_at DESC LIMIT 200`, [vendorId, status || null]);
  return rows.map(shape);
}

function shape(r) {
  return {
    id: r.id, orderNumber: r.order_number, vendorId: r.vendor_id, lane: r.lane, status: r.status,
    itemCents: asInt(r.item_cents), laneCDeliveryCents: asInt(r.lane_c_delivery_cents),
    confirmedAt: r.confirmed_at, acceptBy: r.accept_by, readyBy: r.ready_by, acceptedAt: r.accepted_at, readyAt: r.ready_at,
    insuranceChoice: r.insurance_choice, insuranceCents: asInt(r.insurance_cents), deliveryServiceCents: asInt(r.delivery_service_cents),
    carrier: r.carrier, trackingNumber: r.tracking_number, deliveredAt: r.delivered_at, cancelledAt: r.cancelled_at,
    cancelCode: r.cancel_code, cancelNote: r.cancel_note, items: r.items || []
  };
}

async function loadOwn(q, vendorId, id) {
  const { rows } = await q('SELECT * FROM vendor_orders WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [id, vendorId]);
  if (!rows.length) throw new Error('Order not found.');
  return rows[0];
}

/**
 * Accept an order. Lanes A and B REQUIRE an explicit insurance choice — there is no default, so
 * nobody can later say they did not know. Past the 24 hours it is refused and the order lapses.
 */
export async function acceptVendorOrder(vendorId, id, { insurance, by, now = new Date() } = {}) {
  const lapsed = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const o = await loadOwn(q, vendorId, id);
    if (o.status !== 'awaiting_accept') throw new Error(`This order is ${o.status.replace('_', ' ')}.`);
    if (now > at(o.accept_by)) return true;                       // handled below, outside the lock
    let choice = null; let ins = 0; let svc = 0;
    if (o.lane !== 'C') {
      if (!['insured', 'declined'].includes(insurance)) throw new Error('Choose whether to insure this shipment, or decline insurance.');
      choice = insurance;
      const { rows: items } = await q(
        `SELECT l.price, l.weight_lb, l.width_in, l.depth_in, l.height_in FROM order_items oi JOIN marketplace_listings l ON l.id = oi.listing_id
          WHERE oi.order_id = $1 AND oi.vendor_id = $2 AND l.lane = $3`, [o.order_id, vendorId, o.lane]);
      const { rows: rt } = await q('SELECT size_class, cents FROM delivery_service_rates');
      const rate = Object.fromEntries(rt.map((r) => [r.size_class, asInt(r.cents)]));
      for (const it of items) svc += rate[sizeClassFor({ weightLb: it.weight_lb, widthIn: it.width_in, depthIn: it.depth_in, heightIn: it.height_in })] || 0;
      if (choice === 'insured') ins = insuranceCents(asInt(o.item_cents));
    }
    await q(`UPDATE vendor_orders SET status = 'accepted', accepted_at = $2, insurance_choice = $3, insurance_cents = $4, delivery_service_cents = $5 WHERE id = $1`,
      [id, now.toISOString(), choice, ins, svc]);
    await logVendorEvent(q, vendorId, 'order_accepted', by, { order: o.order_number, insurance: choice });
    return false;
  });
  if (lapsed) {
    await lapseAccept(id, { now });
    throw new Error('The 24 hours to accept this order have passed, so it has been cancelled and the customer refunded.');
  }
  return { ok: true };
}

/**
 * Ready for collection/delivery — or, in Lane C, tracking submitted. Being late does not block it
 * (the strike is already, or is now, issued) because refusing a late "ready" would strand a paid unit.
 */
export async function markVendorOrderReady(vendorId, id, { carrier, trackingNumber, by, now = new Date() } = {}) {
  const lateStrike = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const o = await loadOwn(q, vendorId, id);
    if (o.status !== 'accepted') throw new Error(o.status === 'awaiting_accept' ? 'Accept the order first.' : `This order is ${o.status.replace('_', ' ')}.`);
    let car = null; let trk = null;
    if (o.lane === 'C') {
      if (!CARRIERS.includes(carrier)) throw new Error('Choose the carrier.');
      if (!trackingLooksValid(trackingNumber)) throw new Error('Enter the tracking number (at least 8 letters or digits).');
      car = carrier; trk = String(trackingNumber).trim();
    }
    await q(`UPDATE vendor_orders SET status = 'ready', ready_at = $2, carrier = $3, tracking_number = $4 WHERE id = $1`, [id, now.toISOString(), car, trk]);
    await logVendorEvent(q, vendorId, 'order_ready', by, { order: o.order_number, carrier: car });
    return now > at(o.ready_by) && !o.ready_strike_id ? o : null;
  });
  if (lateStrike) await strikeReady(lateStrike, { now });
  return { ok: true };
}

/** The vendor cancels a paid order (typically out of stock). The customer is refunded in full; it is a strike, every time. */
export async function cancelVendorOrder(vendorId, id, { reasonCode, note, by, now = new Date() } = {}) {
  if (!VENDOR_CANCEL_REASONS[reasonCode]) throw new Error('Choose a reason from the list.');
  if (reasonCode === 'other' && !String(note || '').trim()) throw new Error('"Other" needs an explanation.');
  const o = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const row = await loadOwn(q, vendorId, id);
    if (!['awaiting_accept', 'accepted', 'ready'].includes(row.status)) throw new Error(`This order is ${row.status.replace('_', ' ')} and cannot be cancelled.`);
    await q(`UPDATE vendor_orders SET status = 'cancelled', cancelled_at = $2, cancel_code = $3, cancel_note = $4, cancelled_by = $5 WHERE id = $1`,
      [id, now.toISOString(), reasonCode, note || null, by || 'vendor']);
    await logVendorEvent(q, vendorId, 'order_cancelled', by, { order: row.order_number, reasonCode });
    return row;
  });
  await afterCancel(o, { reasonCode, strike: 'cancelled_order', now });
  return { ok: true };
}

// --- cancellations, lapses and strikes ---------------------------------------------

async function refundVendorLines(o) {
  // The customer's order has one invoice; take this vendor's lines off it through the same
  // refund path staff use, so the books and the revenue dashboard stay right.
  try {
    const { rows: skus } = await query('SELECT sku FROM order_items WHERE order_id = $1 AND vendor_id = $2 AND listing_id IN (SELECT id FROM marketplace_listings WHERE lane = $3)', [o.order_id, o.vendor_id, o.lane]);
    const { orderInvoiceLink } = await import('./orders');
    const inv = await orderInvoiceLink(o.order_id);
    if (!inv) return { ok: false, why: 'no invoice found for the order' };
    const { refundInvoiceItems } = await import('./invoices');
    // The reason text is how the general ledger knows this refund was of a SELLER's sale (it books
    // against what we owe sellers, not against Sales) — see VENDOR_REFUND_REASON.
    const r = await refundInvoiceItems(inv.id, { skus: skus.map((x) => x.sku), reason: VENDOR_REFUND_REASON, by: 'system' });
    // The refund took the lines off the customer's order; take them off the seller's share of it too, or
    // the revenue figures (which subtract that share) would subtract it twice. A Lane C delivery share the
    // seller will no longer earn becomes ours, so it leaves the seller's share as well.
    await query(
      `UPDATE orders SET vendor_subtotal = GREATEST(0, vendor_subtotal - $2), vendor_hst = GREATEST(0, vendor_hst - $3) WHERE id = $1`,
      [o.order_id, (asInt(o.item_cents) + asInt(o.lane_c_delivery_cents)) / 100, asInt(o.hst_cents) / 100]);
    return { ok: true, amount: r.refundAmount };
  } catch (e) {
    return { ok: false, why: e?.message || String(e) };
  }
}

async function afterCancel(o, { reasonCode, strike, now }) {
  // the unit is no longer with a seller who can deliver it: park the listing, the vendor decides what next
  await query(`UPDATE marketplace_listings SET status = CASE WHEN $2 = 'out_of_stock' THEN 'withdrawn' ELSE 'paused' END, updated_at = now()
                WHERE id IN (SELECT listing_id FROM order_items WHERE order_id = $1 AND vendor_id = $3 AND listing_id IS NOT NULL) AND status = 'sold'`,
    [o.order_id, reasonCode || '', o.vendor_id]).catch((e) => console.error('listing park failed', e.message));
  if (strike) {
    try { await issueStrike(o.vendor_id, { reason: strike, orderRef: o.order_number, note: `Vendor order ${o.id}`, by: 'system' }); }
    catch (e) { console.error('strike failed', e.message); }
  }
  const refund = await refundVendorLines(o);
  await tellOffice(`Seller cancelled ${o.order_number} — refund the customer`,
    `<p>A seller could not fulfil <b>${esc(o.order_number)}</b> (${esc(reasonCode || 'lapsed')}). The customer is owed a full refund of the seller's lines.</p>`
    + (refund.ok ? `<p>The refund has been recorded on the invoice (${esc(String(refund.amount ?? ''))}). <b>Send the customer the money by e-transfer</b> and tell them.</p>`
      : `<p><b>The refund could NOT be recorded automatically</b> (${esc(refund.why)}). Please refund the lines on the invoice by hand — type "${esc(VENDOR_REFUND_REASON)}" as the reason so the books treat it as the seller's — then send the customer the money.</p>`));
  await tellVendor(o.vendor_id, `Order ${o.order_number} was cancelled`, `<p>Order ${esc(o.order_number)} was cancelled and the customer refunded. This counts as a strike on your account.</p>`);
}

async function lapseAccept(id, { now = new Date() } = {}) {
  const o = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(`SELECT * FROM vendor_orders WHERE id = $1 AND status = 'awaiting_accept' FOR UPDATE`, [id]);
    if (!rows.length) return null;
    await q(`UPDATE vendor_orders SET status = 'cancelled', cancelled_at = $2, cancel_code = 'accept_timeout', cancelled_by = 'system' WHERE id = $1`, [id, now.toISOString()]);
    await logVendorEvent(q, rows[0].vendor_id, 'order_lapsed', 'system', { order: rows[0].order_number });
    return rows[0];
  });
  if (o) await afterCancel(o, { reasonCode: 'accept_timeout', strike: 'missed_accept', now });
  return !!o;
}

async function strikeReady(o, { now = new Date() } = {}) {
  let strikeId = null;
  try {
    const s = await issueStrike(o.vendor_id, { reason: 'missed_ready', orderRef: o.order_number, note: `Vendor order ${o.id}`, by: 'system' });
    strikeId = s.strikeId;
  } catch (e) { console.error('ready strike failed', e.message); return; }
  await query('UPDATE vendor_orders SET ready_strike_id = $2 WHERE id = $1', [o.id, strikeId]);
  await tellOffice(`Order ${o.order_number} is overdue — not ready within ${READY_HOURS} hours`,
    `<p>The seller missed the ${READY_HOURS}-hour deadline on <b>${esc(o.order_number)}</b>. A strike was issued. The customer may cancel for a full refund — please contact them.</p>`);
  await tellVendor(o.vendor_id, `Order ${o.order_number} is overdue`, `<p>Order ${esc(o.order_number)} was not ready within ${READY_HOURS} hours. This counts as a strike. Please get it ready now.</p>`);
}

/**
 * The half-hourly sweep: lapse unaccepted orders at 24h, strike unready ones at 72h, send the
 * reminders, and close vendor orders whose customer order never got paid. Idempotent — every
 * action is guarded by the state it changes — so running it twice, or late, only does what is due.
 */
export async function sweepVendorOrders({ now = new Date() } = {}) {
  const out = { lapsed: 0, struck: 0, reminded: 0, closed: 0 };
  const iso = now.toISOString();

  const { rows: stale } = await query(
    `UPDATE vendor_orders vo SET status = 'cancelled', cancelled_at = $1, cancel_code = 'not_paid', cancelled_by = 'system'
      FROM orders o WHERE o.id = vo.order_id AND vo.status = 'awaiting_payment' AND o.status IN ('cancelled','refunded') RETURNING vo.id`, [iso]);
  out.closed = stale.length;

  const { rows: overdueAccept } = await query(`SELECT id FROM vendor_orders WHERE status = 'awaiting_accept' AND accept_by < $1`, [iso]);
  for (const r of overdueAccept) if (await lapseAccept(r.id, { now })) out.lapsed++;

  const { rows: overdueReady } = await query(`SELECT * FROM vendor_orders WHERE status = 'accepted' AND ready_by < $1 AND ready_strike_id IS NULL`, [iso]);
  for (const o of overdueReady) { await strikeReady(o, { now }); out.struck++; }

  for (const h of REMINDER_ACCEPT_HOURS) {
    const col = h === 12 ? 'reminded_accept_12' : 'reminded_accept_20';
    const { rows } = await query(
      `UPDATE vendor_orders SET ${col} = true WHERE status = 'awaiting_accept' AND ${col} = false
          AND confirmed_at <= $1::timestamptz - make_interval(hours => $2) RETURNING vendor_id, order_number, accept_by`, [iso, h]);
    for (const r of rows) {
      await tellVendor(r.vendor_id, `Reminder: accept order ${r.order_number} by ${when(r.accept_by)}`,
        `<p>You have not accepted order ${esc(r.order_number)} yet. <b>It will be cancelled, the customer refunded and a strike issued at ${esc(when(r.accept_by))}.</b></p>`);
      out.reminded++;
    }
  }
  const { rows: readyRem } = await query(
    `UPDATE vendor_orders SET reminded_ready_60 = true WHERE status = 'accepted' AND reminded_ready_60 = false
        AND confirmed_at <= $1::timestamptz - make_interval(hours => $2) RETURNING vendor_id, order_number, ready_by, lane`, [iso, REMINDER_READY_HOUR]);
  for (const r of readyRem) {
    await tellVendor(r.vendor_id, `Reminder: order ${r.order_number} must be ready by ${when(r.ready_by)}`,
      `<p>Order ${esc(r.order_number)} must be ready${r.lane === 'C' ? ' with tracking submitted' : ''} by <b>${esc(when(r.ready_by))}</b>, or it is a strike.</p>`);
    out.reminded++;
  }
  // Warranty claims ride the same half-hourly pass (a 48-hour deadline checked daily would be up to a day
  // late), and so does giving back reserves that have run their twelve months. Each is isolated: a problem
  // here must never stop the order clocks above from having been judged.
  try { const { sweepWarrantyClaims } = await import('./warranty-claims'); out.claims = await sweepWarrantyClaims({ now }); }
  catch (e) { console.error('claims sweep failed', e?.message || e); }
  try {
    const { openClaimRefs } = await import('./warranty-claims');
    const { releaseWarrantyReserves } = await import('./vendor-ledger');
    out.reserveReleased = (await releaseWarrantyReserves({ now, blocked: await openClaimRefs() })).released;
  } catch (e) { console.error('reserve release failed', e?.message || e); }
  return out;
}

// --- delivery and settlement -----------------------------------------------------------

/**
 * The unit reached the customer: book the sale to the vendor's ledger (it becomes payable after the
 * tier's hold). Lanes A/B are triggered by the order being marked delivered; Lane C by staff once the
 * carrier confirms. Idempotent.
 */
export async function deliverVendorOrder(id, { by = 'system', deliveredAt = new Date() } = {}) {
  const o = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(`SELECT vo.*, o.created_at AS ordered_at FROM vendor_orders vo JOIN orders o ON o.id = vo.order_id WHERE vo.id = $1 FOR UPDATE OF vo`, [id]);
    if (!rows.length) throw new Error('Order not found.');
    const r = rows[0];
    if (r.status === 'delivered') return null;
    if (!['accepted', 'ready'].includes(r.status)) throw new Error(`A ${r.status.replace('_', ' ')} order cannot be marked delivered.`);
    await q(`UPDATE vendor_orders SET status = 'delivered', delivered_at = $2 WHERE id = $1`, [id, deliveredAt.toISOString()]);
    return r;
  });
  if (!o) return { ok: true, already: true };
  await recordOrderSettlement(o.vendor_id, `${o.order_number}:${o.id}`, {
    itemCents: asInt(o.item_cents), deliveredAt, orderedOn: at(o.ordered_at).toISOString().slice(0, 10),
    deliveryServiceCents: asInt(o.delivery_service_cents), insuranceCents: asInt(o.insurance_cents),
    laneCDeliveryCents: asInt(o.lane_c_delivery_cents), hstOnSaleCents: asInt(o.hst_cents)
  }, { by });
  await query('UPDATE vendor_orders SET settled_at = now() WHERE id = $1', [id]);
  await logVendorEvent(query, o.vendor_id, 'order_delivered', by, { order: o.order_number });
  return { ok: true };
}

/**
 * The hook the rest of the system calls when a customer order changes status
 * (lib/orders.js updateOrderStatus). Never throws: a marketplace problem must not block an order.
 */
export async function onOrderStatus(orderId, status, { by = 'system' } = {}) {
  try {
    if (status === 'confirmed') await confirmVendorOrders(orderId, { by });
    else if (status === 'delivered') {
      const { rows } = await query(`SELECT id FROM vendor_orders WHERE order_id = $1 AND lane <> 'C' AND status IN ('accepted','ready')`, [orderId]);
      for (const r of rows) await deliverVendorOrder(r.id, { by });
    } else if (status === 'cancelled') {
      await query(`UPDATE vendor_orders SET status = 'cancelled', cancelled_at = now(), cancel_code = 'order_cancelled', cancelled_by = $2 WHERE order_id = $1 AND status IN ('awaiting_payment')`, [orderId, by]);
    }
  } catch (e) {
    console.error('vendor order hook failed', status, e?.message || e);
  }
}

// --- staff views -------------------------------------------------------------------------

export async function allVendorOrders({ status, limit = 300 } = {}) {
  const { rows } = await query(
    `SELECT vo.*, COALESCE(v.trade_name, v.legal_name) AS vendor FROM vendor_orders vo JOIN vendors v ON v.id = vo.vendor_id
      WHERE vo.status <> 'awaiting_payment' AND ($1::text IS NULL OR vo.status = $1)
      ORDER BY CASE vo.status WHEN 'awaiting_accept' THEN 0 WHEN 'accepted' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, vo.created_at DESC LIMIT $2`, [status || null, limit]);
  return rows.map((r) => ({ ...shape(r), vendor: r.vendor }));
}

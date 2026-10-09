// What we owe each vendor, as an append-only ledger. See docs/marketplace/PLAN.md §8.2.
//
// A balance is NEVER stored: it is SUM(amount_cents). Every order's settlement is a SET of
// entries (the sale, the commission, the fees, the 2% warranty hold) that all become available
// on the same day — delivery plus the tier's hold — and each is keyed, so a retried settlement
// writes nothing the second time. Money is integer cents throughout.
import { query, withTransaction } from './db';
import {
  payoutBreakdown, holdDaysFor, WARRANTY_RESERVE_MONTHS
} from './marketplace-rules';
import { commissionBpsFor } from './vendors';

const DAY = 24 * 3600 * 1000;
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const asInt = (v) => Number(v ?? 0);
// A Date's toString() is "Sat Oct 03 ...", not an ISO date — the same trap the customer follow-ups
// fell into. Always go through toISOString for a Date.
const isoDay = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

/** Append one entry. Returns the new id, or null when this idempotency key was already used. */
export async function appendEntry(q, e) {
  const { rows } = await q(
    `INSERT INTO vendor_ledger (vendor_id, kind, amount_cents, order_ref, ref, memo, actor, available_at, idem_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9)
     ON CONFLICT (idem_key) WHERE idem_key IS NOT NULL DO NOTHING RETURNING id`,
    [e.vendorId, e.kind, e.amountCents, e.orderRef || null, e.ref || null, e.memo || null, e.actor || null,
     e.availableAt ? new Date(e.availableAt).toISOString() : null, e.idemKey || null]);
  return rows[0]?.id ?? null;
}

/**
 * Book a delivered order. Idempotent per order. `orderedOn` picks the commission rate in force
 * on the day of the sale — a later raise never touches it.
 *   itemCents             the vendor's price (pre-tax)
 *   laneCDeliveryCents    the vendor's 80% of the customer's delivery fee (Lane C only)
 *   deliveryServiceCents  our fee for collecting/delivering (Lanes A/B)
 *   insuranceCents        premium, if the vendor chose cover
 */
export async function recordOrderSettlement(vendorId, orderRef, o, { by = 'system' } = {}) {
  if (!orderRef) throw new Error('Which order?');
  if (!(o.itemCents > 0)) throw new Error('The item price is required.');
  if (!o.deliveredAt) throw new Error('A sale is settled when it is delivered.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows: v } = await q('SELECT tier FROM vendors WHERE id = $1', [vendorId]);
    if (!v.length) throw new Error('No such vendor.');
    const bps = await commissionBpsFor(vendorId, isoDay(o.orderedOn || o.deliveredAt));
    const b = payoutBreakdown({
      itemCents: o.itemCents, commissionBps: bps, deliveryServiceCents: o.deliveryServiceCents || 0,
      insuranceCents: o.insuranceCents || 0, laneCDeliveryCents: o.laneCDeliveryCents || 0,
      hstOnSaleCents: o.hstOnSaleCents || 0
    });
    const availableAt = addDays(o.deliveredAt, holdDaysFor(v[0].tier));
    const k = (kind) => `settle:${vendorId}:${orderRef}:${kind}`;
    const base = { vendorId, orderRef, actor: by, availableAt };
    const rows = [
      ['sale', b.itemCents], ['lane_c_delivery', b.laneCDeliveryCents], ['commission', -b.commission],
      ['delivery_service_fee', -b.deliveryServiceCents], ['insurance', -b.insuranceCents], ['warranty_hold', -b.reserve],
      ['hst_on_sale', b.hstOnSaleCents], ['hst_on_fees', -b.hstOnFeesCents]
    ];
    let wrote = 0;
    for (const [kind, amount] of rows) {
      if (!amount) continue;
      if (await appendEntry(q, { ...base, kind, amountCents: amount, idemKey: k(kind) })) wrote++;
    }
    return { ok: true, alreadyBooked: wrote === 0, breakdown: b, availableAt, commissionBps: bps };
  });
}

/** Money that goes back to a customer (or to us) after the fact. Immediate, never held. */
export async function recordDeduction(vendorId, { kind, amountCents, orderRef, memo, by, idemKey }) {
  if (!['refund', 'guarantee_claim', 'chargeback'].includes(kind)) throw new Error('Not a deduction kind.');
  if (!(amountCents > 0)) throw new Error('Enter the amount as a positive number.');
  const id = await appendEntry(query, { vendorId, kind, amountCents: -Math.round(amountCents), orderRef, memo, actor: by, idemKey });
  return { ok: true, id, duplicate: id === null };
}

/** What is still held in the warranty reserve for one order: the holds, less anything already released or drawn. */
export async function reserveRemaining(q, vendorId, orderRef) {
  if (!orderRef) return 0;
  const { rows } = await q(
    `SELECT COALESCE(-SUM(amount_cents) FILTER (WHERE kind = 'warranty_hold'), 0)
          - COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'warranty_release'), 0) AS left
       FROM vendor_ledger WHERE vendor_id = $1 AND order_ref = $2`, [vendorId, orderRef]);
  return Math.max(0, asInt(rows[0]?.left));
}

/**
 * Take money off a seller, with a keyed (idempotent) entry. `drawReserve` pays a warranty claim from the
 * order's 2% reserve FIRST — a release of exactly what is drawn, then the deduction for the whole amount —
 * and the rest comes off the balance. Both rows go in one transaction, so the books never see half.
 *
 * Why the arithmetic is safe for the general ledger: a seller's share of account 2160 is their balance
 * PLUS the reserve held. A draw moves X from the reserve into the balance (+X balance, -X reserve: no
 * change to the sum) and the deduction then takes the full amount off the balance. The sum falls by the
 * amount, which is exactly what the journal debits to 2160.
 *
 * `bookedElsewhere` marks a customer refund that was ALREADY journalled through the invoice refund path
 * (which debits 2160 itself): the seller's ledger must still fall, but the journal must not debit twice.
 * The balance may go negative when a claim exceeds balance + reserve; that is a debt, not an error, and
 * payout eligibility will not pay a negative balance.
 */
export async function deduct(vendorId, { kind, amountCents, orderRef, memo, by, idemKey, drawReserve = false, bookedElsewhere = false }) {
  if (!['refund', 'guarantee_claim', 'chargeback'].includes(kind)) throw new Error('Not a deduction kind.');
  const amt = Math.round(Number(amountCents));
  if (!(amt > 0)) throw new Error('Enter the amount as a positive number.');
  if (!idemKey) throw new Error('A deduction needs an idempotency key.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const id = await appendEntry(q, {
      vendorId, kind, amountCents: -amt, orderRef, memo, actor: by, idemKey, ref: bookedElsewhere ? 'booked-elsewhere' : null
    });
    if (id === null) return { ok: true, id: null, duplicate: true, drawnCents: 0 };
    let drawn = 0;
    if (drawReserve && orderRef) {
      drawn = Math.min(amt, await reserveRemaining(q, vendorId, orderRef));
      if (drawn > 0) await appendEntry(q, {
        vendorId, kind: 'warranty_release', amountCents: drawn, orderRef, memo: `Reserve drawn to pay: ${memo || kind}`,
        actor: by, idemKey: `draw:${idemKey}`
      });
    }
    return { ok: true, id, duplicate: false, drawnCents: drawn };
  });
}

/** Admin only: a correcting entry, in either direction, with a reason. */
export async function adjust(vendorId, { amountCents, memo, by, idemKey }) {
  if (!by) throw new Error('Who is making this adjustment?');
  if (!String(memo || '').trim()) throw new Error('An adjustment needs a reason.');
  const n = Math.round(Number(amountCents));
  if (!n) throw new Error('The amount cannot be zero.');
  return { ok: true, id: await appendEntry(query, { vendorId, kind: 'adjustment', amountCents: n, memo: String(memo).trim(), actor: by, idemKey: idemKey || null }) };
}

/**
 * Give back warranty holds that have run their 12 months. `blocked` = order refs with an open
 * warranty claim (supplied by the caller; the reserve stays while a claim is open). Run daily.
 */
export async function releaseWarrantyReserves({ now = new Date(), blocked = new Set() } = {}) {
  // Per order: what was held less what has already left the reserve (a paid claim may have drawn some).
  const { rows } = await query(
    `SELECT h.vendor_id, h.order_ref,
            -SUM(h.amount_cents) FILTER (WHERE h.kind = 'warranty_hold')
            - COALESCE(SUM(h.amount_cents) FILTER (WHERE h.kind = 'warranty_release'), 0) AS remaining,
            (SELECT MAX(a.available_at) FROM vendor_ledger a WHERE a.vendor_id = h.vendor_id AND a.order_ref = h.order_ref AND a.kind = 'sale') AS settled_at
       FROM vendor_ledger h
      WHERE h.kind IN ('warranty_hold','warranty_release') AND h.order_ref IS NOT NULL
      GROUP BY h.vendor_id, h.order_ref`);
  let released = 0;
  for (const r of rows) {
    if (blocked.has(r.order_ref) || !r.settled_at || !(asInt(r.remaining) > 0)) continue;
    // 12 months from DELIVERY: availability is delivery + hold, which is close enough that the
    // reserve is never released early, and never more than the hold days late.
    if (addMonths(r.settled_at, WARRANTY_RESERVE_MONTHS) > now) continue;
    const id = await appendEntry(query, {
      vendorId: r.vendor_id, kind: 'warranty_release', amountCents: asInt(r.remaining), orderRef: r.order_ref,
      actor: 'system', idemKey: `release:${r.vendor_id}:${r.order_ref}`
    });
    if (id) released++;
  }
  return { released };
}

/** The vendor's money, from the ledger alone. */
export async function vendorBalance(vendorId, now = new Date()) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE available_at <= $2::timestamptz), 0) AS available,
       COALESCE(SUM(amount_cents) FILTER (WHERE available_at >  $2::timestamptz), 0) AS pending,
       COALESCE(-SUM(amount_cents) FILTER (WHERE kind = 'warranty_hold'), 0)
         - COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'warranty_release'), 0) AS reserve_held,
       COALESCE(-SUM(amount_cents) FILTER (WHERE kind IN ('payout','payout_reversal')), 0) AS paid_out
       FROM vendor_ledger WHERE vendor_id = $1`, [vendorId, now.toISOString()]);
  const r = rows[0];
  return {
    availableCents: asInt(r.available), pendingCents: asInt(r.pending),
    reserveHeldCents: asInt(r.reserve_held), paidOutCents: asInt(r.paid_out)
  };
}

/** Itemised entries for a vendor, newest first. Vendor-scoped by the id the caller passes. */
export async function vendorStatement(vendorId, { from, to, limit = 500 } = {}) {
  const { rows } = await query(
    `SELECT id, kind, amount_cents, order_ref, memo, at, available_at
       FROM vendor_ledger WHERE vendor_id = $1 AND ($2::date IS NULL OR at >= $2::date) AND ($3::date IS NULL OR at < $3::date + 1)
      ORDER BY at DESC, id DESC LIMIT $4`, [vendorId, from || null, to || null, Math.min(Number(limit) || 500, 2000)]);
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind, amountCents: asInt(r.amount_cents), orderRef: r.order_ref,
    memo: r.memo, at: r.at, availableAt: r.available_at
  }));
}

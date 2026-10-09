// Warranty claims on marketplace units. See the Returns, Warranty & Guarantee policy.
//
// The customer contacts US. Staff open the claim against the delivered vendor order; the seller has 48
// hours to respond and 7 days to resolve it (repair or replace; or agree that we refund the customer).
// A missed deadline is ONE strike per claim, whichever is missed first. If the seller does not fix it we
// do, and an admin charges the cost to the seller: the 2% warranty reserve for that order pays first, the
// balance pays the rest.
//
// Who may do what: staff open, note, close and resolve (it is the customer's sale); recording MONEY out and
// charging the seller is ADMIN only (lib/ledger and the route enforce it). The seller sees their own claims
// only and never the customer's email or phone — this table does not hold them.
import { query, withTransaction } from './db';
import { sendEmail, esc } from './email';
import { issueStrike, logVendorEvent } from './vendors';
import { deduct } from './vendor-ledger';
import { SERVICE_EMAIL, TZ } from './constants';
import { CLAIM_RESPOND_HOURS, CLAIM_RESOLVE_DAYS, CLAIM_RESOLUTIONS, WARRANTY_MONTHS } from './marketplace-rules';

const HOUR = 3600 * 1000;
const at = (v) => new Date(v);
const when = (d) => at(d).toLocaleString('en-CA', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const asInt = (v) => Number(v ?? 0);
const clean = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
export const OPEN_CLAIM_STATES = ['open', 'responded', 'awaiting_refund'];
const orderRefOf = (c) => `${c.order_number}:${c.vendor_order_id}`;

function shape(r, { forStaff = false } = {}) {
  const out = {
    id: r.id, orderNumber: r.order_number, sku: r.sku, title: r.title, description: r.description, status: r.status,
    openedAt: r.opened_at, respondBy: r.respond_by, resolveBy: r.resolve_by,
    vendorRespondedAt: r.vendor_responded_at, vendorResponse: r.vendor_response, vendorDoneAt: r.vendor_done_at,
    resolution: r.resolution, resolutionNote: r.resolution_note, resolvedAt: r.resolved_at, closedReason: r.closed_reason,
    struck: !!r.strike_id
  };
  if (forStaff) Object.assign(out, {
    vendorId: r.vendor_id, vendorOrderId: r.vendor_order_id, vendor: r.vendor, openedBy: r.opened_by, resolvedBy: r.resolved_by,
    costCents: r.cost_cents == null ? null : asInt(r.cost_cents), chargedAt: r.charged_at, chargedBy: r.charged_by, strikeId: r.strike_id
  });
  return out;
}

export { claimState } from './claim-state';

async function addNote(q, claimId, { author, side, note, internal = false }) {
  const text = clean(note);
  if (!text) return;
  await q('INSERT INTO warranty_claim_notes (claim_id, author, side, internal, note) VALUES ($1,$2,$3,$4,$5)', [claimId, author || 'system', side, internal, text]);
}

async function tellVendor(vendorId, subject, html) {
  try {
    const { rows: v } = await query('SELECT contact_email FROM vendors WHERE id = $1', [vendorId]);
    const { rows: u } = await query('SELECT email FROM vendor_users WHERE vendor_id = $1 AND revoked_at IS NULL', [vendorId]);
    const to = [...new Set([v[0]?.contact_email, ...u.map((r) => r.email)].filter(Boolean).map((e) => e.toLowerCase()))];
    for (const addr of to) await sendEmail({ to: addr, subject, html });
  } catch (e) { console.error('claim notification failed', e?.message || e); }
}
async function tellOffice(subject, html) {
  try { await sendEmail({ to: SERVICE_EMAIL, subject, html }); } catch (e) { console.error('claim office email failed', e?.message || e); }
}

// --- staff ------------------------------------------------------------------------------------------

/**
 * Open a claim against a DELIVERED vendor order, inside the unit's warranty. One open claim per unit.
 * `sku` may be left out when the order has one unit from this seller.
 */
export async function openClaim({ vendorOrderId, sku, description, by, now = new Date() }) {
  if (!by) throw new Error('Who is opening the claim?');
  const desc = clean(description);
  if (desc.length < 10) throw new Error('Describe what is wrong (at least a sentence).');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT * FROM vendor_orders WHERE id = $1 FOR UPDATE', [Number(vendorOrderId)]);
    const vo = rows[0];
    if (!vo) throw new Error('No such vendor order.');
    if (vo.status !== 'delivered' || !vo.delivered_at) throw new Error('A warranty claim is opened on a delivered order. This one has not been delivered.');
    const expires = new Date(at(vo.delivered_at)); expires.setUTCMonth(expires.getUTCMonth() + WARRANTY_MONTHS);
    if (expires < now) throw new Error(`This unit is outside its ${WARRANTY_MONTHS}-month warranty.`);
    const { rows: units } = await q(
      `SELECT l.sku, l.title FROM order_items oi JOIN marketplace_listings l ON l.id = oi.listing_id
        WHERE oi.order_id = $1 AND oi.vendor_id = $2 AND l.lane = $3 ORDER BY l.id`, [vo.order_id, vo.vendor_id, vo.lane]);
    const unit = sku ? units.find((u) => u.sku === sku) : (units.length === 1 ? units[0] : null);
    if (!unit) throw new Error(sku ? 'That unit is not on this seller\'s part of the order.' : 'Say which unit the claim is about.');
    const dup = await q(`SELECT 1 FROM warranty_claims WHERE vendor_order_id = $1 AND sku = $2 AND status = ANY($3)`, [vo.id, unit.sku, OPEN_CLAIM_STATES]);
    if (dup.rows.length) throw new Error('There is already an open claim on that unit.');
    const { rows: ins } = await q(
      `INSERT INTO warranty_claims (vendor_order_id, vendor_id, order_number, sku, title, description, opened_at, opened_by, respond_by, resolve_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [vo.id, vo.vendor_id, vo.order_number, unit.sku, unit.title, desc, now.toISOString(), by,
       new Date(now.getTime() + CLAIM_RESPOND_HOURS * HOUR).toISOString(), new Date(now.getTime() + CLAIM_RESOLVE_DAYS * 24 * HOUR).toISOString()]);
    await logVendorEvent(q, vo.vendor_id, 'claim_opened', by, { claim: ins[0].id, order: vo.order_number, sku: unit.sku });
    return { ok: true, id: ins[0].id, orderNumber: vo.order_number, vendorId: vo.vendor_id, sku: unit.sku };
  }).then(async (r) => {
    await tellVendor(r.vendorId, `Warranty claim on ${r.orderNumber} — respond within ${CLAIM_RESPOND_HOURS} hours`,
      `<p>A customer has made a warranty claim on <b>${esc(r.sku)}</b> (order ${esc(r.orderNumber)}).</p>
       <p>Respond within <b>${CLAIM_RESPOND_HOURS} hours</b> and resolve it (repair, replace, or agree that we refund) within <b>${CLAIM_RESOLVE_DAYS} days</b>. A missed deadline is a strike.</p>
       <p>Open your vendor portal → Claims.</p>`);
    return { ok: true, id: r.id };
  });
}

export async function listClaims({ status } = {}) {
  const { rows } = await query(
    `SELECT w.*, COALESCE(v.trade_name, v.legal_name) AS vendor FROM warranty_claims w JOIN vendors v ON v.id = w.vendor_id
      WHERE ($1::text IS NULL OR ($1 = 'open' AND w.status = ANY($2)) OR w.status = $1)
      ORDER BY (w.status = ANY($2)) DESC, w.opened_at DESC LIMIT 300`, [status || null, OPEN_CLAIM_STATES]);
  const { rows: notes } = rows.length
    ? await query('SELECT * FROM warranty_claim_notes WHERE claim_id = ANY($1) ORDER BY at, id', [rows.map((r) => r.id)]) : { rows: [] };
  return rows.map((r) => ({
    ...shape(r, { forStaff: true }),
    notes: notes.filter((n) => n.claim_id === r.id).map((n) => ({ at: n.at, author: n.author, side: n.side, internal: n.internal, note: n.note }))
  }));
}

export async function staffNote(claimId, { note, internal = false, by }) {
  if (!clean(note)) throw new Error('Write the note.');
  await addNote(query, Number(claimId), { author: by, side: 'staff', note, internal: !!internal });
  return { ok: true };
}

/** Staff close a claim that is not valid or was withdrawn. Nothing is charged. */
export async function closeClaim(claimId, { reason, by }) {
  if (!clean(reason)) throw new Error('Say why the claim is closed.');
  const { rows } = await query(
    `UPDATE warranty_claims SET status = 'closed', closed_reason = $2, resolved_at = now(), resolved_by = $3
      WHERE id = $1 AND status = ANY($4) RETURNING id`, [Number(claimId), clean(reason), by, OPEN_CLAIM_STATES]);
  if (!rows.length) throw new Error('That claim is not open.');
  return { ok: true };
}

/** Staff mark it resolved: it was repaired/replaced/refunded (by the seller, or by us after they did not). */
export async function staffResolve(claimId, { resolution, note, by }) {
  if (!CLAIM_RESOLUTIONS[resolution]) throw new Error('Choose repair, replace or refund.');
  const { rows } = await query(
    `UPDATE warranty_claims SET status = 'resolved', resolution = $2, resolution_note = $3, resolved_at = now(), resolved_by = $4,
            vendor_done_at = COALESCE(vendor_done_at, now())
      WHERE id = $1 AND status = ANY($5) RETURNING id`, [Number(claimId), resolution, clean(note) || null, by, OPEN_CLAIM_STATES]);
  if (!rows.length) throw new Error('That claim is not open.');
  return { ok: true };
}

/**
 * ADMIN: record what we paid and take it from the seller. Once per claim (a keyed ledger entry plus a
 * row guard). `kind` is guarantee_claim (we paid the customer) or chargeback (a cost of ours: a repair
 * we paid for). The order's 2% reserve pays first; the balance pays the rest.
 */
export async function chargeClaim(claimId, { amountCents, kind = 'guarantee_claim', note, by }) {
  if (!by) throw new Error('Who is recording this?');
  if (!['guarantee_claim', 'chargeback'].includes(kind)) throw new Error('Choose guarantee claim or charge-back.');
  const amt = Math.round(Number(amountCents));
  if (!(amt > 0)) throw new Error('Enter the amount we paid, in dollars.');
  const { rows } = await query('SELECT * FROM warranty_claims WHERE id = $1', [Number(claimId)]);
  const c = rows[0];
  if (!c) throw new Error('Claim not found.');
  if (c.charged_at) throw new Error('This claim has already been charged to the seller.');
  const claimed = await query(`UPDATE warranty_claims SET charged_at = now(), charged_by = $2, cost_cents = $3 WHERE id = $1 AND charged_at IS NULL RETURNING id`, [c.id, by, amt]);
  if (!claimed.rows.length) throw new Error('This claim has already been charged to the seller.');
  try {
    const r = await deduct(c.vendor_id, {
      kind, amountCents: amt, orderRef: orderRefOf(c), by, idemKey: `claim:${c.id}`, drawReserve: true,
      memo: `Warranty claim ${c.id} on ${c.order_number} (${c.sku})${note ? ` — ${clean(note, 200)}` : ''}`
    });
    await logVendorEvent(query, c.vendor_id, 'claim_charged', by, { claim: c.id, amountCents: amt, drawnFromReserveCents: r.drawnCents });
    await tellVendor(c.vendor_id, `Warranty claim on ${c.order_number} charged to your account`,
      `<p>We resolved the warranty claim on <b>${esc(c.sku)}</b> (order ${esc(c.order_number)}) and the cost of $${(amt / 100).toFixed(2)} has been taken from your warranty reserve first, then your balance.</p>`);
    return { ok: true, drawnFromReserveCents: r.drawnCents, fromBalanceCents: amt - r.drawnCents };
  } catch (e) {
    await query('UPDATE warranty_claims SET charged_at = NULL, charged_by = NULL, cost_cents = NULL WHERE id = $1', [c.id]);   // nothing was written: let them try again
    throw e;
  }
}

// --- the seller's side (every call takes the vendor id from the session) ------------------------------

export async function listVendorClaims(vendorId) {
  const { rows } = await query(
    `SELECT * FROM warranty_claims WHERE vendor_id = $1 ORDER BY (status = ANY($2)) DESC, opened_at DESC LIMIT 200`, [vendorId, OPEN_CLAIM_STATES]);
  const { rows: notes } = rows.length
    ? await query('SELECT * FROM warranty_claim_notes WHERE claim_id = ANY($1) AND internal = false ORDER BY at, id', [rows.map((r) => r.id)]) : { rows: [] };
  return rows.map((r) => ({
    ...shape(r),
    notes: notes.filter((n) => n.claim_id === r.id).map((n) => ({ at: n.at, side: n.side, note: n.note }))
  }));
}

async function loadOwn(q, vendorId, id) {
  const { rows } = await q('SELECT * FROM warranty_claims WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [Number(id), vendorId]);
  if (!rows.length) throw new Error('Claim not found.');
  return rows[0];
}

/** The seller answers: what they will do. Late is allowed (the strike is the penalty; refusing would strand the customer). */
export async function vendorRespond(vendorId, id, { note, by, now = new Date() }) {
  if (clean(note).length < 5) throw new Error('Tell us what you will do.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const claim = await loadOwn(q, vendorId, id);
    if (!OPEN_CLAIM_STATES.includes(claim.status)) throw new Error(`This claim is ${claim.status.replace('_', ' ')}.`);
    await q(`UPDATE warranty_claims SET vendor_responded_at = COALESCE(vendor_responded_at, $2), vendor_response = $3,
                    status = CASE WHEN status = 'open' THEN 'responded' ELSE status END WHERE id = $1`, [claim.id, now.toISOString(), clean(note)]);
    await addNote(q, claim.id, { author: by, side: 'vendor', note });
    await logVendorEvent(q, vendorId, 'claim_responded', by, { claim: claim.id });
    return { ok: true };
  });
}

/**
 * The seller has done their part: repaired it, replaced it, or agrees we refund the customer (money out is
 * ours to record, so a refund leaves the claim open for staff, but the seller's deadline is met).
 */
export async function vendorResolve(vendorId, id, { resolution, note, by, now = new Date() }) {
  if (!CLAIM_RESOLUTIONS[resolution]) throw new Error('Choose repair, replace or refund.');
  if (clean(note).length < 5) throw new Error('Say what was done.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const claim = await loadOwn(q, vendorId, id);
    if (!OPEN_CLAIM_STATES.includes(claim.status)) throw new Error(`This claim is ${claim.status.replace('_', ' ')}.`);
    const refund = resolution === 'refund';
    await q(`UPDATE warranty_claims SET vendor_done_at = COALESCE(vendor_done_at, $2), vendor_responded_at = COALESCE(vendor_responded_at, $2),
                    resolution = $3, resolution_note = $4, status = $5,
                    resolved_at = CASE WHEN $5 = 'resolved' THEN $2::timestamptz ELSE NULL END,
                    resolved_by = CASE WHEN $5 = 'resolved' THEN $6 ELSE NULL END WHERE id = $1`,
      [claim.id, now.toISOString(), resolution, clean(note), refund ? 'awaiting_refund' : 'resolved', by]);
    await addNote(q, claim.id, { author: by, side: 'vendor', note: `${CLAIM_RESOLUTIONS[resolution]}: ${note}` });
    await logVendorEvent(q, vendorId, 'claim_resolved_by_vendor', by, { claim: claim.id, resolution });
    return { ok: true, awaitingRefund: refund };
  }).then(async (r) => {
    if (r.awaitingRefund) await tellOffice(`Seller agrees to refund warranty claim ${id}`, `<p>The seller agreed that we refund the customer for claim ${esc(String(id))}. Refund the customer, then record the amount in Admin → Marketplace → Claims.</p>`);
    return r;
  });
}

// --- the sweep ----------------------------------------------------------------------------------------

/**
 * Reminders and the strike. Idempotent and safe to run often. ONE strike per claim, claim-first: the
 * row is marked before the strike is issued, so two overlapping sweeps cannot both strike, and a strike
 * that fails to issue releases the mark so the next sweep tries again.
 */
export async function sweepWarrantyClaims({ now = new Date() } = {}) {
  const out = { reminded: 0, struck: 0 };
  const iso = now.toISOString();

  // reminders: the response one when 24h of the 48 have gone, the resolution one at day 5 of 7
  const respRem = await query(
    `UPDATE warranty_claims SET reminded_respond = true
      WHERE status = 'open' AND vendor_responded_at IS NULL AND reminded_respond = false
        AND opened_at <= $1::timestamptz - make_interval(hours => $2) AND respond_by > $1::timestamptz
      RETURNING vendor_id, order_number, sku, respond_by`, [iso, CLAIM_RESPOND_HOURS / 2]);
  for (const r of respRem.rows) {
    await tellVendor(r.vendor_id, `Reminder: respond to the warranty claim on ${r.order_number}`,
      `<p>You have not answered the warranty claim on ${esc(r.sku)}. <b>Respond by ${esc(when(r.respond_by))}</b> or it is a strike.</p>`); out.reminded++;
  }
  const resRem = await query(
    `UPDATE warranty_claims SET reminded_resolve = true
      WHERE status = ANY($3) AND vendor_done_at IS NULL AND reminded_resolve = false
        AND opened_at <= $1::timestamptz - make_interval(days => $2) AND resolve_by > $1::timestamptz
      RETURNING vendor_id, order_number, sku, resolve_by`, [iso, CLAIM_RESOLVE_DAYS - 2, OPEN_CLAIM_STATES]);
  for (const r of resRem.rows) {
    await tellVendor(r.vendor_id, `Reminder: resolve the warranty claim on ${r.order_number}`,
      `<p>The warranty claim on ${esc(r.sku)} must be resolved by <b>${esc(when(r.resolve_by))}</b>, or it is a strike and we will fix it and charge you.</p>`); out.reminded++;
  }

  // the strike: no answer in time, or not resolved in time, whichever comes first
  const { rows: late } = await query(
    `SELECT * FROM warranty_claims
      WHERE status = ANY($2) AND strike_id IS NULL AND strike_pending_at IS NULL
        AND ((status = 'open' AND vendor_responded_at IS NULL AND respond_by < $1::timestamptz)
          OR (vendor_done_at IS NULL AND resolve_by < $1::timestamptz))`, [iso, OPEN_CLAIM_STATES]);
  for (const c of late) {
    const mark = await query(`UPDATE warranty_claims SET strike_pending_at = now() WHERE id = $1 AND strike_id IS NULL AND strike_pending_at IS NULL RETURNING id`, [c.id]);
    if (!mark.rows.length) continue;
    try {
      const s = await issueStrike(c.vendor_id, { reason: 'warranty_response', orderRef: c.order_number, note: `Warranty claim ${c.id}`, by: 'system' });
      await query('UPDATE warranty_claims SET strike_id = $2 WHERE id = $1', [c.id, s.strikeId]);
      out.struck++;
      await tellOffice(`Warranty claim ${c.id} on ${c.order_number} is overdue — strike issued`,
        `<p>The seller missed a warranty-claim deadline on <b>${esc(c.sku)}</b> (${esc(c.order_number)}). A strike was issued. Resolve it ourselves and charge the seller in Admin → Marketplace → Claims.</p>`);
      await tellVendor(c.vendor_id, `Warranty claim on ${c.order_number} is overdue`,
        `<p>A warranty-claim deadline on ${esc(c.sku)} was missed. This counts as a strike on your account. We will resolve the claim and charge the cost to you (your warranty reserve first, then your balance).</p>`);
    } catch (e) {
      console.error('warranty strike failed', c.id, e?.message || e);
      await query('UPDATE warranty_claims SET strike_pending_at = NULL WHERE id = $1 AND strike_id IS NULL', [c.id]);
    }
  }
  return out;
}

/** Order refs (`<order number>:<vendor order id>`, as the settlement keys them) with a claim still open: their reserve stays held. */
export async function openClaimRefs() {
  const { rows } = await query('SELECT order_number, vendor_order_id FROM warranty_claims WHERE status = ANY($1)', [OPEN_CLAIM_STATES]);
  return new Set(rows.map((r) => `${r.order_number}:${r.vendor_order_id}`));
}

/** What a staff (non-admin) browser may see: the cost figures are the business's books and are not sent at all. */
export function claimsForViewer(claims, admin) {
  return admin ? claims : claims.map(({ costCents, chargedAt, chargedBy, ...rest }) => ({ ...rest, charged: !!chargedAt }));
}

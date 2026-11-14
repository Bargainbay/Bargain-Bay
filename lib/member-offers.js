// Offers from approved resellers on a single unit.
//
// A request, never a price change by itself: an ADMIN accepts (or counters), and only then is the unit held for the
// member for OFFER_HOLD_HOURS and the agreed price applied for THAT member (decorate() in lib/pricing.js reads
// acceptedOfferMap). The floor is enforced on submit AND again on accept/counter, because cost or the member rates may
// have moved. Cost never leaves this module toward a member: a refusal says only "too low".
import { hasDb, query } from './db';
import { getById } from './inventory';
import { isApprovedMember, costFloorOf, decorateOne } from './pricing';
import { getMemberRates } from './member-rates';
import { consignmentFloors } from './consignment';
import { holdForRep } from './rep-holds';
import { audit } from './audit';
import { sendEmail, notifyOwner, esc } from './email';
import { SITE_URL } from './site';
import { money, round2 } from './constants';
import { OFFER_HOLD_HOURS, MAX_OPEN_OFFERS, MAX_OFFERS_PER_DAY, offerFloor, offerProblem } from './member-offer-rules';

export class OfferError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}
const norm = (e) => String(e || '').trim().toLowerCase();

let ensured = false;
async function ensure() {
  if (ensured || !hasDb()) return;
  await query(`CREATE TABLE IF NOT EXISTS member_offers (
    id serial PRIMARY KEY, user_id integer NOT NULL, email text NOT NULL, business_name text, sku text NOT NULL, title text,
    list_price numeric(10,2) NOT NULL, amount numeric(10,2) NOT NULL, note text, status text NOT NULL DEFAULT 'open',
    agreed_price numeric(10,2), admin_note text, decided_by text, decided_at timestamptz, expires_at timestamptz,
    order_id integer, created_at timestamptz NOT NULL DEFAULT now())`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS member_offers_one_live ON member_offers (user_id, upper(sku)) WHERE status IN ('open','countered','accepted')`);
  ensured = true;
}

// What this member pays today for the unit, and the floor under any offer. Server-side only.
async function unitFacts(sku, session) {
  const raw = await getById(sku);
  if (!raw) return null;
  const u = await decorateOne({ ...raw }, session);
  const { rates } = await getMemberRates();
  const cost = Number(raw.cost) || 0;
  const consign = (await consignmentFloors([raw.id]).catch(() => new Map())).get(raw.id)?.floor || 0;
  const floor = offerFloor({ cost, memberFloor: costFloorOf(raw, u.clientPrice, rates), consignFloor: consign });
  return { unit: u, raw, memberPrice: u.priceBeforeOffer ?? u.price, floor };
}

export async function submitOffer(session, { sku, amount, note = '' }) {
  if (!hasDb()) throw new OfferError('Database not configured.', 'nodb');
  if (!(await isApprovedMember(session))) throw new OfferError('Offers are for approved resellers.', 'forbidden');
  await ensure();
  const id = String(sku || '').trim();
  if (!id) throw new OfferError('Which unit?');
  const facts = await unitFacts(id, session);
  const { unavailableSkus } = await import('./reservations');
  if (!facts || (await unavailableSkus([facts.unit.id])).has(facts.unit.id)) throw new OfferError('That unit is not available right now.', 'unavailable');
  if (facts.unit.marketplace || facts.unit.vesta) throw new OfferError('Offers are only taken on our own stock.');
  const amt = round2(Number(amount));
  const bad = offerProblem({ amount: amt, memberPrice: facts.memberPrice, floor: facts.floor });
  if (bad) throw new OfferError(bad, 'price');

  const { rows: c } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('open','countered','accepted'))::int AS live,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
       FROM member_offers WHERE user_id = $1`, [session.userId]);
  if (c[0].live >= MAX_OPEN_OFFERS) throw new OfferError(`You have ${MAX_OPEN_OFFERS} offers open. Withdraw one or wait for an answer.`, 'limit');
  if (c[0].today >= MAX_OFFERS_PER_DAY) throw new OfferError('That is the limit for today. Try again tomorrow.', 'limit');

  const { rows: m } = await query(`SELECT business_name FROM users WHERE id = $1`, [session.userId]).catch(() => ({ rows: [] }));
  let row;
  try {
    ({ rows: [row] } = await query(
      `INSERT INTO member_offers (user_id, email, business_name, sku, title, list_price, amount, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [session.userId, norm(session.email), m[0]?.business_name || null, facts.unit.id,
       facts.unit.title || `${facts.unit.make} ${facts.unit.model}`, facts.memberPrice, amt, String(note || '').trim().slice(0, 500) || null]));
  } catch (e) {
    if (e.code === '23505') throw new OfferError('You already have an offer on that unit.', 'duplicate');
    throw e;
  }
  await notifyOwner(`Reseller offer: ${facts.unit.title || facts.unit.id}`,
    `<p>${esc(m[0]?.business_name || session.email)} offered <b>${money(amt)}</b> on ${esc(facts.unit.title || facts.unit.id)} (${esc(facts.unit.id)}), their price ${money(facts.memberPrice)}.</p>
     <p><a href="${SITE_URL}/admin/offers">Review offers</a></p>`).catch(() => {});
  return { ok: true, id: row.id };
}

export async function myOffers(userId) {
  if (!hasDb()) return [];
  await ensure().catch(() => {});
  await expireOffers().catch(() => {});
  const { rows } = await query(
    `SELECT id, sku, title, list_price, amount, status, agreed_price, expires_at, created_at, note
       FROM member_offers WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]).catch(() => ({ rows: [] }));
  return rows;
}

export async function withdrawOffer(userId, id) {
  await ensure();
  const { rows } = await query(
    `UPDATE member_offers SET status = 'withdrawn', decided_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('open','countered','accepted') RETURNING sku, status`, [id, userId]);
  if (!rows[0]) throw new OfferError('That offer is not open.', 'notfound');
  // An accepted offer's hold belongs to the member; give the unit back.
  await query(`DELETE FROM reservations WHERE upper(sku) = upper($1) AND order_id IS NULL AND held_by = (SELECT email FROM member_offers WHERE id = $2)`, [rows[0].sku, id]).catch(() => {});
  return { ok: true };
}

/** Admin queue. Includes cost-derived figures, so the caller must be an admin. */
export async function listOffersAdmin({ status = 'open' } = {}) {
  if (!hasDb()) return [];
  await ensure().catch(() => {});
  await expireOffers().catch(() => {});
  const where = status === 'all' ? '' : status === 'open' ? `WHERE o.status IN ('open','countered')` : `WHERE o.status = $1`;
  const { rows } = await query(
    `SELECT o.*, p.cost, p.price AS tracker_price, p.sold_at FROM member_offers o
       LEFT JOIN products p ON upper(p.sku) = upper(o.sku) ${where} ORDER BY o.created_at DESC LIMIT 200`,
    status === 'all' || status === 'open' ? [] : [status]).catch(() => ({ rows: [] }));
  return rows.map((r) => ({ ...r, list_price: Number(r.list_price), amount: Number(r.amount), cost: r.cost == null ? null : Number(r.cost),
    agreed_price: r.agreed_price == null ? null : Number(r.agreed_price) }));
}

export async function openOfferCount() {
  if (!hasDb()) return 0;
  const { rows } = await query(`SELECT count(*)::int AS n FROM member_offers WHERE status = 'open'`).catch(() => ({ rows: [{ n: 0 }] }));
  return rows[0].n;
}

/** decision: 'accept' | 'decline' | 'counter' (counter needs `price`). Accept/counter re-check the floor. */
export async function decideOffer(id, decision, { price = null, note = '' } = {}, admin) {
  await ensure();
  const { rows } = await query(`SELECT * FROM member_offers WHERE id = $1`, [id]);
  const o = rows[0];
  if (!o || !['open', 'countered'].includes(o.status)) throw new OfferError('That offer has already been answered.', 'notfound');
  const adminNote = String(note || '').trim().slice(0, 500) || null;

  if (decision === 'decline') {
    await query(`UPDATE member_offers SET status='declined', admin_note=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [id, adminNote, norm(admin?.email)]);
    await audit(admin, { action: 'offer.decline', entity: 'member_offer', entityId: id, summary: `Declined ${o.email} on ${o.sku}` });
    await tell(o, 'declined', null, adminNote);
    return { ok: true };
  }
  if (decision !== 'accept' && decision !== 'counter') throw new OfferError('Unknown decision.');

  const raw = await getById(o.sku);
  const { unavailableSkus } = await import('./reservations');
  if (!raw || (await unavailableSkus([raw.id])).has(raw.id)) {
    await query(`UPDATE member_offers SET status='expired', decided_at=now(), admin_note='Unit no longer available' WHERE id=$1`, [id]);
    throw new OfferError('That unit has sold or is held, so the offer was closed.', 'unavailable');
  }
  const agreed = round2(Number(decision === 'counter' ? price : o.amount));
  const { rates } = await getMemberRates();
  const pub = (await decorateOne({ ...raw }, null)).price;
  const consign = (await consignmentFloors([raw.id]).catch(() => new Map())).get(raw.id)?.floor || 0;
  const floor = offerFloor({ cost: raw.cost, memberFloor: costFloorOf(raw, pub, rates), consignFloor: consign });
  if (!Number.isFinite(agreed) || agreed < floor) throw new OfferError(`That is under the floor (${money(floor)}). Counter at or above it.`, 'floor');
  if (agreed > pub) throw new OfferError('That is above the public price.', 'price');

  if (decision === 'counter') {
    await query(`UPDATE member_offers SET status='countered', agreed_price=$2, admin_note=$3, decided_by=$4, decided_at=now() WHERE id=$1`,
      [id, agreed, adminNote, norm(admin?.email)]);
    await audit(admin, { action: 'offer.counter', entity: 'member_offer', entityId: id, summary: `Countered ${o.email} on ${o.sku} at ${agreed}` });
    await tell(o, 'countered', agreed, adminNote);
    return { ok: true, status: 'countered' };
  }
  await holdForRep(raw.id, { hours: OFFER_HOLD_HOURS, note: `Offer #${id}` }, { email: o.email });
  await query(`UPDATE member_offers SET status='accepted', agreed_price=$2, admin_note=$3, decided_by=$4, decided_at=now(),
                 expires_at = now() + ($5 || ' hours')::interval WHERE id=$1`, [id, agreed, adminNote, norm(admin?.email), String(OFFER_HOLD_HOURS)]);
  await audit(admin, { action: 'offer.accept', entity: 'member_offer', entityId: id, summary: `Accepted ${o.email} on ${o.sku} at ${agreed}` });
  await tell(o, 'accepted', agreed, adminNote);
  return { ok: true, status: 'accepted' };
}

/** A member takes the admin's counter: same hold and price as an accept. */
export async function acceptCounter(session, id) {
  await ensure();
  const { rows } = await query(`SELECT * FROM member_offers WHERE id=$1 AND user_id=$2 AND status='countered'`, [id, session.userId]);
  const o = rows[0];
  if (!o) throw new OfferError('That counter-offer is not open.', 'notfound');
  try { await holdForRep(o.sku, { hours: OFFER_HOLD_HOURS, note: `Offer #${id}` }, { email: o.email }); }
  catch { throw new OfferError('Sorry, that unit has just been sold or held.', 'unavailable'); }
  await query(`UPDATE member_offers SET status='accepted', expires_at = now() + ($2 || ' hours')::interval WHERE id=$1`, [id, String(OFFER_HOLD_HOURS)]);
  return { ok: true };
}

export async function expireOffers() {
  if (!hasDb()) return;
  await query(`UPDATE member_offers SET status='expired' WHERE status='accepted' AND expires_at < now()`);
  // A counter nobody took in 3 days lapses too.
  await query(`UPDATE member_offers SET status='expired' WHERE status='countered' AND decided_at < now() - interval '3 days'`);
}

/** sku(upper) -> agreed price, for ONE member's live accepted offers. decorate() applies it; checkout then charges it. */
export async function acceptedOfferMap(email) {
  if (!hasDb() || !email) return new Map();
  try {
    const { rows } = await query(
      `SELECT sku, agreed_price FROM member_offers WHERE lower(email)=$1 AND status='accepted' AND expires_at > now()`, [norm(email)]);
    return new Map(rows.map((r) => [String(r.sku).toUpperCase(), Number(r.agreed_price)]));
  } catch { return new Map(); }
}

/** SKUs held for THIS member's accepted offer: not "unavailable" to them (cart, availability, checkout). */
export async function ownOfferSkus(email) {
  return new Set([...(await acceptedOfferMap(email)).keys()]);
}

/** Called by checkout in the order's transaction: the offer is used up, and the member's own hold is cleared so the order's reservation can take it. */
export async function consumeOffers(client, email, skus, orderId) {
  for (const sku of skus) {
    const { rowCount } = await client.query(
      `UPDATE member_offers SET status='purchased', order_id=$3 WHERE lower(email)=$1 AND upper(sku)=upper($2) AND status='accepted' AND expires_at > now()`,
      [norm(email), sku, orderId]);
    if (rowCount) await client.query(`DELETE FROM reservations WHERE sku=$1 AND order_id IS NULL AND lower(held_by)=$2`, [sku, norm(email)]);
  }
}

async function tell(o, what, price, adminNote) {
  const first = 'there';
  const lines = {
    accepted: `<p>Good news: we accepted your offer of <b>${money(price)}</b> on ${esc(o.title || o.sku)}. It is held for you for ${OFFER_HOLD_HOURS} hours. Open your <a href="${SITE_URL}/account/member">dashboard</a>, add it to your order and check out; the price is applied automatically.</p>`,
    countered: `<p>We can't do ${money(o.amount)} on ${esc(o.title || o.sku)}, but we can do <b>${money(price)}</b>. You have 3 days to take it from your <a href="${SITE_URL}/account/member">dashboard</a>. Nothing is held until you do.</p>`,
    declined: `<p>Thanks for your offer on ${esc(o.title || o.sku)}. We can't accept it at that price. Your reseller price still applies if you'd like to buy it.</p>`
  }[what];
  await sendEmail({ to: o.email, subject: `Your offer: ${what}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b"><p>Hi ${first},</p>${lines}${adminNote ? `<p><i>${esc(adminNote)}</i></p>` : ''}</div>` }).catch(() => {});
}

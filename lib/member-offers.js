// Offers on a single unit: from an approved reseller (kind 'member') or from anyone who gives an email and phone (kind 'public').
//
// A request, never a price change by itself: an ADMIN accepts (or counters), and only then is the unit held for the buyer
// (members 48h, everyone else 24h) and the agreed price applied for THAT buyer. A member is recognised by their account; a guest
// by a private link emailed to them, which sets the `bb_offers` cookie (decorate() in lib/pricing.js reads it). The floor is
// enforced on submit AND again on accept/counter, because cost may have moved. Cost never leaves this module toward a buyer:
// a refusal says only "too low". A public offer cannot be accepted until its email address has been confirmed.
import { cookies } from 'next/headers';
import { hasDb, query } from './db';
import { getById } from './inventory';
import { isApprovedMember, costFloorOf, decorateOne } from './pricing';
import { getMemberRates } from './member-rates';
import { consignmentFloors } from './consignment';
import { holdForRep } from './rep-holds';
import { audit } from './audit';
import { sendEmail, notifyOwner, esc } from './email';
import { linkToken, verifyLinkToken } from './links';
import { isBlocked, isDisposableEmail } from './antifraud';
import { SITE_URL } from './site';
import { getSetting, setSetting } from './settings';
import { money, round2, phoneKey } from './constants';
import { validEmail, normalizeEmail } from './auth';
import {
  MAX_OPEN_OFFERS, MAX_OFFERS_PER_DAY, MAX_PUBLIC_OFFERS_PER_IP_DAY,
  offerFloor, offerProblem, publicOfferFloor, holdHoursFor, hasOfferRoom
} from './member-offer-rules';

export class OfferError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}
const norm = (e) => String(e || '').trim().toLowerCase();
export const OFFER_COOKIE = 'bb_offers';
export const offerToken = (id) => linkToken('offer', String(id));
export const offerLink = (id) => `${SITE_URL}/offer/${id}?t=${offerToken(id)}`;

let ensured = false;
async function ensure() {
  if (ensured || !hasDb()) return;
  await query(`CREATE TABLE IF NOT EXISTS member_offers (
    id serial PRIMARY KEY, user_id integer, kind text NOT NULL DEFAULT 'member', name text, phone text, verified_at timestamptz, ip text,
    email text NOT NULL, business_name text, sku text NOT NULL, title text,
    list_price numeric(10,2) NOT NULL, amount numeric(10,2) NOT NULL, note text, status text NOT NULL DEFAULT 'open',
    agreed_price numeric(10,2), admin_note text, decided_by text, decided_at timestamptz, expires_at timestamptz,
    order_id integer, created_at timestamptz NOT NULL DEFAULT now())`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS member_offers_one_live ON member_offers (lower(email), upper(sku)) WHERE status IN ('open','countered','accepted')`);
  ensured = true;
}

// Price and floors for a unit. `member` picks which price the offer must undercut and which floor applies.
async function unitFacts(sku, session, kind) {
  const raw = await getById(sku);
  if (!raw) return null;
  const u = await decorateOne({ ...raw }, kind === 'member' ? session : null);
  const consign = (await consignmentFloors([raw.id]).catch(() => new Map())).get(raw.id)?.floor || 0;
  let floor;
  if (kind === 'member') {
    const { rates } = await getMemberRates();
    floor = offerFloor({ cost: raw.cost, memberFloor: costFloorOf(raw, u.clientPrice, rates), consignFloor: consign });
  } else {
    floor = Math.max(Number(raw.cost) || 0, publicOfferFloor({ cost: raw.cost, consignFloor: consign }));
  }
  return { unit: u, raw, price: u.priceBeforeOffer ?? u.price, floor };
}

async function submit({ kind, user = null, name = null, email, phone = null, ip = null, businessName = null, sku, amount, note }, session) {
  if (!hasDb()) throw new OfferError('Database not configured.', 'nodb');
  await ensure();
  const id = String(sku || '').trim();
  if (!id) throw new OfferError('Which unit?');
  const facts = await unitFacts(id, session, kind);
  const { unavailableSkus } = await import('./reservations');
  if (!facts || facts.unit.sold || (await unavailableSkus([facts.unit.id])).has(facts.unit.id)) throw new OfferError('That unit is not available right now.', 'unavailable');
  if (facts.unit.marketplace || facts.unit.vesta) throw new OfferError('Offers are only taken on our own stock.');
  const amt = round2(Number(amount));
  const mode = kind === 'public' ? (await getOfferModes())[String(facts.unit.id).toUpperCase()] : null;
  if (mode === 'closed') throw new OfferError('This one is already priced to go, so we are not taking offers on it. It is available at the listed price.', 'notopen');
  if (kind === 'public' && mode !== 'open' && !hasOfferRoom({ price: facts.price, floor: facts.floor, refurbished: facts.unit.condition === 'Refurbished' })) {
    throw new OfferError('This one is already priced to go, so we are not taking offers on it. It is available at the listed price.', 'notopen');
  }
  const bad = offerProblem({ amount: amt, memberPrice: facts.price, floor: facts.floor });
  if (bad) throw new OfferError(bad, 'price');

  const { rows: c } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('open','countered','accepted'))::int AS live,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
       FROM member_offers WHERE lower(email) = $1`, [norm(email)]);
  if (c[0].live >= MAX_OPEN_OFFERS) throw new OfferError(`You have ${MAX_OPEN_OFFERS} offers open. Withdraw one or wait for an answer.`, 'limit');
  if (c[0].today >= MAX_OFFERS_PER_DAY) throw new OfferError('That is the limit for today. Try again tomorrow.', 'limit');
  if (ip) {
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM member_offers WHERE ip = $1 AND created_at > now() - interval '24 hours'`, [ip]);
    if (n[0].n >= MAX_PUBLIC_OFFERS_PER_IP_DAY) throw new OfferError('Too many offers from this connection today. Try again tomorrow.', 'limit');
  }

  let row;
  try {
    ({ rows: [row] } = await query(
      `INSERT INTO member_offers (user_id, kind, name, email, phone, ip, business_name, sku, title, list_price, amount, note, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [user, kind, name, norm(email), phone, ip, businessName, facts.unit.id,
       facts.unit.title || `${facts.unit.make} ${facts.unit.model}`, facts.price, amt,
       String(note || '').trim().slice(0, 500) || null, kind === 'member' ? new Date() : null]));
  } catch (e) {
    if (e.code === '23505') throw new OfferError('You already have an offer on that unit.', 'duplicate');
    throw e;
  }
  return { id: row.id, facts, amt };
}

export async function submitOffer(session, { sku, amount, note = '' }) {
  if (!(await isApprovedMember(session))) throw new OfferError('Offers are for approved resellers.', 'forbidden');
  await ensure();
  const { rows: m } = await query(`SELECT business_name FROM users WHERE id = $1`, [session.userId]).catch(() => ({ rows: [] }));
  const { id, facts, amt } = await submit({ kind: 'member', user: session.userId, email: session.email, businessName: m[0]?.business_name || null, sku, amount, note }, session);
  await notifyOwner(`Reseller offer: ${facts.unit.title || facts.unit.id}`,
    `<p>${esc(m[0]?.business_name || session.email)} offered <b>${money(amt)}</b> on ${esc(facts.unit.title || facts.unit.id)} (${esc(facts.unit.id)}), their price ${money(facts.price)}.</p><p><a href="${SITE_URL}/admin/offers">Review offers</a></p>`).catch(() => {});
  return { ok: true, id };
}

/** Anyone: name, email and phone required. The offer waits for the email to be confirmed before staff can act on it. */
export async function submitPublicOffer({ sku, amount, name, email, phone, note = '', ip = null }) {
  const em = normalizeEmail(email);
  const nm = String(name || '').trim().slice(0, 80);
  if (!nm) throw new OfferError('Please enter your name.');
  if (!validEmail(em)) throw new OfferError('Please enter a valid email address.');
  if (!phoneKey(phone)) throw new OfferError('Please enter a phone number we can reach you on.');
  if (isDisposableEmail(em)) throw new OfferError('Please use a regular email address.');
  if (await isBlocked({ email: em, ip, phone: String(phone) }).catch(() => false)) throw new OfferError('We cannot take an offer from that contact.', 'blocked');
  const { id, facts, amt } = await submit({ kind: 'public', name: nm, email: em, phone: String(phone).trim().slice(0, 30), ip, sku, amount, note }, null);
  await sendEmail({ to: em, subject: 'Confirm your offer',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b"><p>Hi ${esc(nm.split(' ')[0])},</p>
      <p>You offered <b>${money(amt)}</b> on ${esc(facts.unit.title || facts.unit.id)}. Please <a href="${offerLink(id)}">confirm your email</a> so we can look at it. We will answer by email, usually within a business day.</p>
      <p style="font-size:12.5px;color:#666">If you did not make this offer you can ignore this message.</p></div>` }).catch(() => {});
  return { ok: true, id };
}

/** The buyer clicked the emailed link and pressed Confirm. */
export async function confirmOffer(id, token) {
  if (!verifyLinkToken('offer', String(id), token)) throw new OfferError('That link is not valid.', 'forbidden');
  await ensure();
  const { rows: was } = await query(`SELECT verified_at FROM member_offers WHERE id = $1`, [id]);
  const { rows } = await query(`UPDATE member_offers SET verified_at = COALESCE(verified_at, now()) WHERE id = $1 AND status IN ('open','countered','accepted') RETURNING title, amount, name, email`, [id]);
  if (!rows[0]) throw new OfferError('That offer is no longer open.', 'notfound');
  if (was[0]?.verified_at) return { ok: true };   // pressed twice: the owner is told once
  await notifyOwner(`Offer to review: ${rows[0].title}`, `<p>${esc(rows[0].name || rows[0].email)} offered <b>${money(Number(rows[0].amount))}</b> on ${esc(rows[0].title)}.</p><p><a href="${SITE_URL}/admin/offers">Review offers</a></p>`).catch(() => {});
  return { ok: true };
}

export async function offerByLink(id, token) {
  if (!verifyLinkToken('offer', String(id), token) || !hasDb()) return null;
  await ensure().catch(() => {});
  await expireOffers().catch(() => {});
  const { rows } = await query(`SELECT id, kind, sku, title, amount, list_price, status, agreed_price, expires_at, verified_at, name FROM member_offers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  return rows[0] || null;
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

async function release(id) {
  await query(`DELETE FROM reservations WHERE upper(sku) = (SELECT upper(sku) FROM member_offers WHERE id = $1) AND order_id IS NULL
                 AND lower(held_by) = (SELECT lower(email) FROM member_offers WHERE id = $1)`, [id]).catch(() => {});
}

/** `who` is { userId } for a signed-in member, or { token } for a guest holding the emailed link. */
export async function withdrawOffer(who, id) {
  await ensure();
  const byUser = who.userId != null;
  if (!byUser && !verifyLinkToken('offer', String(id), who.token)) throw new OfferError('That link is not valid.', 'forbidden');
  const { rows } = await query(
    `UPDATE member_offers SET status = 'withdrawn', decided_at = now()
      WHERE id = $1 ${byUser ? 'AND user_id = $2' : ''} AND status IN ('open','countered','accepted') RETURNING id`, byUser ? [id, who.userId] : [id]);
  if (!rows[0]) throw new OfferError('That offer is not open.', 'notfound');
  await release(id);
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
  const { rows } = await query(`SELECT count(*)::int AS n FROM member_offers WHERE status = 'open' AND verified_at IS NOT NULL`).catch(() => ({ rows: [{ n: 0 }] }));
  return rows[0].n;
}

/** decision: 'accept' | 'decline' | 'counter' (counter needs `price`). Accept/counter re-check the floor for the offer's kind. */
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
  if (!o.verified_at) throw new OfferError('Their email is not confirmed yet. Wait for them to confirm, or decline.', 'unverified');

  const raw = await getById(o.sku);
  const { unavailableSkus } = await import('./reservations');
  if (!raw || (await unavailableSkus([raw.id])).has(raw.id)) {
    await query(`UPDATE member_offers SET status='expired', decided_at=now(), admin_note='Unit no longer available' WHERE id=$1`, [id]);
    throw new OfferError('That unit has sold or is held, so the offer was closed.', 'unavailable');
  }
  const agreed = round2(Number(decision === 'counter' ? price : o.amount));
  const pub = (await decorateOne({ ...raw }, null)).price;
  const consign = (await consignmentFloors([raw.id]).catch(() => new Map())).get(raw.id)?.floor || 0;
  let floor;
  if (o.kind === 'member') {
    const { rates } = await getMemberRates();
    floor = offerFloor({ cost: raw.cost, memberFloor: costFloorOf(raw, pub, rates), consignFloor: consign });
  } else {
    floor = Math.max(Number(raw.cost) || 0, publicOfferFloor({ cost: raw.cost, consignFloor: consign }));
  }
  if (!Number.isFinite(agreed) || agreed < floor) throw new OfferError(`That is under the floor (${money(floor)}). Counter at or above it.`, 'floor');
  if (agreed > pub) throw new OfferError('That is above the public price.', 'price');

  if (decision === 'counter') {
    await query(`UPDATE member_offers SET status='countered', agreed_price=$2, admin_note=$3, decided_by=$4, decided_at=now() WHERE id=$1`,
      [id, agreed, adminNote, norm(admin?.email)]);
    await audit(admin, { action: 'offer.counter', entity: 'member_offer', entityId: id, summary: `Countered ${o.email} on ${o.sku} at ${agreed}` });
    await tell(o, 'countered', agreed, adminNote);
    return { ok: true, status: 'countered' };
  }
  const hours = holdHoursFor(o.kind);
  await holdForRep(raw.id, { hours, note: `Offer #${id}` }, { email: o.email });
  await query(`UPDATE member_offers SET status='accepted', agreed_price=$2, admin_note=$3, decided_by=$4, decided_at=now(),
                 expires_at = now() + ($5 || ' hours')::interval WHERE id=$1`, [id, agreed, adminNote, norm(admin?.email), String(hours)]);
  await audit(admin, { action: 'offer.accept', entity: 'member_offer', entityId: id, summary: `Accepted ${o.email} on ${o.sku} at ${agreed}` });
  await tell(o, 'accepted', agreed, adminNote);
  return { ok: true, status: 'accepted' };
}

/** The buyer takes the admin's counter: same hold and price as an accept. */
export async function acceptCounter(who, id) {
  await ensure();
  const byUser = who.userId != null;
  if (!byUser && !verifyLinkToken('offer', String(id), who.token)) throw new OfferError('That link is not valid.', 'forbidden');
  const { rows } = await query(`SELECT * FROM member_offers WHERE id=$1 ${byUser ? 'AND user_id=$2' : ''} AND status='countered'`, byUser ? [id, who.userId] : [id]);
  const o = rows[0];
  if (!o) throw new OfferError('That counter-offer is not open.', 'notfound');
  const hours = holdHoursFor(o.kind);
  try { await holdForRep(o.sku, { hours, note: `Offer #${id}` }, { email: o.email }); }
  catch { throw new OfferError('Sorry, that unit has just been sold or held.', 'unavailable'); }
  await query(`UPDATE member_offers SET status='accepted', expires_at = now() + ($2 || ' hours')::interval WHERE id=$1`, [id, String(hours)]);
  return { ok: true };
}

export async function expireOffers() {
  if (!hasDb()) return;
  await query(`UPDATE member_offers SET status='expired' WHERE status='accepted' AND expires_at < now()`);
  // A counter nobody took in 3 days lapses too, and so does a public offer whose email was never confirmed after 3 days.
  await query(`UPDATE member_offers SET status='expired' WHERE status='countered' AND decided_at < now() - interval '3 days'`);
  await query(`UPDATE member_offers SET status='expired' WHERE status='open' AND verified_at IS NULL AND created_at < now() - interval '3 days'`);
}

// ---- who may buy a held unit, and at what price ---------------------------------------------------------------------------
// A buyer is a signed-in member (by email) and/or a browser that opened an accepted offer's link (the bb_offers cookie,
// "id.token" pairs). The cookie is a bearer link, like a coupon code: whoever holds it holds the offer.
async function cookieIds() {
  try {
    const raw = (await cookies()).get(OFFER_COOKIE)?.value || '';
    return raw.split(',').slice(0, 5).map((p) => p.split('.')).filter(([i, t]) => Number.isInteger(Number(i)) && verifyLinkToken('offer', i, t)).map(([i]) => Number(i));
  } catch { return []; }
}
export const offerCookieValue = (prev, id) =>
  [...(prev || '').split(',').filter((p) => p && !p.startsWith(`${id}.`)), `${id}.${offerToken(id)}`].slice(-5).join(',');

/** { email, ids } for this request, or null when there is nothing to look up (the common case: no DB hit at all). */
export async function offerScope(session) {
  const email = session?.email ? norm(session.email) : '';
  const ids = await cookieIds();
  return email || ids.length ? { email, ids } : null;
}

/** sku(upper) -> agreed price for the live accepted offers in scope. decorate() applies it; checkout then charges it. */
export async function acceptedOfferMap(scope) {
  if (!hasDb() || !scope) return new Map();
  try {
    const { rows } = await query(
      `SELECT sku, agreed_price FROM member_offers
        WHERE status='accepted' AND expires_at > now() AND (lower(email)=$1 OR id = ANY($2::int[]))`, [scope.email, scope.ids]);
    return new Map(rows.map((r) => [String(r.sku).toUpperCase(), Number(r.agreed_price)]));
  } catch { return new Map(); }
}

/** SKUs held for this buyer's own accepted offer: not "unavailable" to them (cart, availability, checkout). */
export async function ownOfferSkus(scope) {
  return new Set([...(await acceptedOfferMap(scope)).keys()]);
}

/** Called by checkout in the order's transaction: the offer is used up, and the buyer's own hold is cleared so the order's reservation can take it. */
export async function consumeOffers(client, scope, skus, orderId) {
  if (!scope) return;
  for (const sku of skus) {
    const { rows } = await client.query(
      `UPDATE member_offers SET status='purchased', order_id=$4
        WHERE upper(sku)=upper($1) AND status='accepted' AND expires_at > now() AND (lower(email)=$2 OR id = ANY($3::int[])) RETURNING email`,
      [sku, scope.email, scope.ids, orderId]);
    for (const r of rows) await client.query(`DELETE FROM reservations WHERE sku=$1 AND order_id IS NULL AND lower(held_by)=$2`, [sku, norm(r.email)]);
  }
}

async function tell(o, what, price, adminNote) {
  const first = String(o.name || '').split(' ')[0] || 'there';
  const hours = holdHoursFor(o.kind);
  const where = o.kind === 'public' ? offerLink(o.id) : `${SITE_URL}/account/member#offers`;
  const lines = {
    accepted: `<p>Good news: we accepted your offer of <b>${money(price)}</b> on ${esc(o.title || o.sku)}. It is held for you for ${hours} hours. <a href="${where}">Open your offer</a> to add it to your order and check out; the price is applied automatically.</p>`,
    countered: `<p>We can't do ${money(o.amount)} on ${esc(o.title || o.sku)}, but we can do <b>${money(price)}</b>. You have 3 days to take it: <a href="${where}">open your offer</a>. Nothing is held until you do.</p>`,
    declined: `<p>Thanks for your offer on ${esc(o.title || o.sku)}. We can't accept it at that price this time. It is still available at the listed price if you'd like it.</p>`
  }[what];
  await sendEmail({ to: o.email, subject: `Your offer: ${what}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b"><p>Hi ${esc(first)},</p>${lines}${adminNote ? `<p><i>${esc(adminNote)}</i></p>` : ''}</div>` }).catch(() => {});
}

/** Ids (upper-case) of the decorated units that are OPEN TO OFFERS from the public. Cost is read here and never returned.
 *  A unit with no cost on record is never open: nobody knows what it can be sold for. Soft-fails to "none open". */
/** Per-unit admin override of the automatic rule: { SKU: 'open' | 'closed' }. 'open' still has to clear the floor. */
export async function getOfferModes() {
  try { const v = await getSetting('offer_modes', {}); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export async function setOfferMode(sku, mode, admin) {
  const key = String(sku || '').trim().toUpperCase();
  if (!key) throw new OfferError('Which unit?');
  if (mode && !['open', 'closed'].includes(mode)) throw new OfferError('Mode must be open, closed, or empty for automatic.');
  const cur = { ...(await getOfferModes()) };
  if (mode) cur[key] = mode; else delete cur[key];
  await setSetting('offer_modes', cur);
  await audit(admin, { action: 'offer.mode', entity: 'unit', entityId: key, summary: `Offers on ${key}: ${mode || 'automatic'}` });
  return { ok: true, modes: cur };
}

export async function openToOffers(units) {
  const own = (units || []).filter((u) => u && !u.marketplace && !u.vesta && !u.vendor);
  if (!own.length || !hasDb()) return new Set();
  try {
    const ids = own.map((u) => u.id);
    const { rows } = await query(`SELECT sku, cost FROM products WHERE sku = ANY($1) AND cost IS NOT NULL`, [ids]);
    const cost = new Map(rows.map((r) => [r.sku, Number(r.cost)]));
    const floors = await consignmentFloors(ids).catch(() => new Map());
    const out = new Set();
    const modes = await getOfferModes();
    for (const u of own) {
      const m = modes[String(u.id).toUpperCase()];
      if (m === 'closed') continue;
      if (m === 'open') { out.add(String(u.id).toUpperCase()); continue; }
      if (!cost.has(u.id)) continue;
      const floor = Math.max(cost.get(u.id), publicOfferFloor({ cost: cost.get(u.id), consignFloor: floors.get(u.id)?.floor || 0 }));
      if (hasOfferRoom({ price: u.clientPrice ?? u.price, floor, refurbished: u.condition === 'Refurbished' })) out.add(String(u.id).toUpperCase());
    }
    return out;
  } catch { return new Set(); }
}

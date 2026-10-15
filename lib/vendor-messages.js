// Messaging between a marketplace seller and Bargain Bay staff.
//
// - A thread belongs to ONE vendor, and may be tied to one of THAT vendor's orders, listings or warranty claims
//   (validated: another vendor's id is refused). Messages are append-only (a trigger enforces it).
// - The author comes from the SESSION (vendor user or staff) and is snapshotted; never from a request body.
// - An INTERNAL staff note lives in the same table but every seller-side query filters it out in SQL, so a
//   seller's payload cannot contain one whatever the UI does.
// - A seller never sees a customer's contact details: a tie-in shows only what vendor-orders already exposes,
//   and a staff message that looks like it carries an email/phone is refused until the sender confirms.
// - No attachments in this slice. Text only.
import { query, withTransaction } from './db';
import { sendEmail, esc } from './email';
import { logVendorEvent } from './vendors';
import { SERVICE_EMAIL } from './constants';
import { SITE_URL } from './site';
import { contactDetailsIn, contactWarning } from './contact-guard';

export const MAX_BODY = 4000;
export const MAX_SUBJECT = 140;
export const VENDOR_MESSAGES_PER_HOUR = 20;
export const VENDOR_THREADS_PER_DAY = 10;
export const EMAIL_THROTTLE_MINUTES = 15;

const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const MIN = 60 * 1000;

/** Thrown when a staff message looks like it carries customer contact details and was not confirmed. */
export class ContactDetailsError extends Error {
  constructor(found) { super(contactWarning(found)); this.needsConfirm = true; this.found = found; }
}

// --- notifications -----------------------------------------------------------------------------------------
// Best-effort and AWAITED (a serverless instance is frozen once the response goes out), never blocking the
// write. One email per side per thread per EMAIL_THROTTLE_MINUTES: the claim is a conditional UPDATE, so two
// messages in the same instant cannot both send. The email never carries the message text.

async function claimEmailSlot(threadId, col, now) {
  const { rows } = await query(
    `UPDATE vendor_threads t SET ${col} = $2
       FROM (SELECT id, ${col} AS prev FROM vendor_threads WHERE id = $1) p
      WHERE t.id = p.id AND (t.${col} IS NULL OR t.${col} < $3)
      RETURNING p.prev`, [threadId, now.toISOString(), new Date(now.getTime() - EMAIL_THROTTLE_MINUTES * MIN).toISOString()]);
  return rows.length ? { prev: rows[0].prev } : null;
}
const releaseEmailSlot = (threadId, col, prev) =>
  query(`UPDATE vendor_threads SET ${col} = $2 WHERE id = $1`, [threadId, prev]).catch(() => {});

async function notify(threadId, toSide, { subject, now = new Date() } = {}) {
  const col = toSide === 'vendor' ? 'vendor_emailed_at' : 'staff_emailed_at';
  let slot = null;
  try {
    slot = await claimEmailSlot(threadId, col, now);
    if (!slot) return { sent: false, throttled: true };
    const { rows } = await query('SELECT vendor_id FROM vendor_threads WHERE id = $1', [threadId]);
    const vendorId = rows[0]?.vendor_id;
    let to;
    if (toSide === 'vendor') {
      const { rows: v } = await query('SELECT contact_email FROM vendors WHERE id = $1', [vendorId]);
      const { rows: u } = await query('SELECT email FROM vendor_users WHERE vendor_id = $1 AND revoked_at IS NULL', [vendorId]);
      to = [...new Set([v[0]?.contact_email, ...u.map((r) => r.email)].filter(Boolean).map((e) => e.toLowerCase()))];
    } else to = [SERVICE_EMAIL];
    if (!to.length) { await releaseEmailSlot(threadId, col, slot.prev); return { sent: false }; }
    const link = toSide === 'vendor' ? `${SITE_URL}/vendor/messages?t=${threadId}` : `${SITE_URL}/admin/marketplace`;
    const html = toSide === 'vendor'
      ? `<p>You have a new message from Bargain Bay about <b>${esc(subject)}</b>.</p><p><a href="${link}">Open your vendor portal → Messages</a></p>`
      : `<p>A seller has written about <b>${esc(subject)}</b>.</p><p><a href="${link}">Open Marketplace → Messages</a></p>`;
    // sendEmail reports failure by RETURNING it (after its own retries), not by throwing.
    const results = [];
    for (const addr of to) results.push(await sendEmail({ to: addr, subject: `New message: ${subject}`, html }));
    if (results.every((r) => !r?.ok && !r?.skipped)) {
      await releaseEmailSlot(threadId, col, slot.prev);   // nothing left: a failed send must not eat the throttle slot
      return { sent: false, error: true };
    }
    return { sent: true };
  } catch (e) {
    console.error('vendor message notification failed', e?.message || e);
    if (slot) await releaseEmailSlot(threadId, col, slot.prev);   // a failed send must not eat the throttle slot
    return { sent: false, error: true };
  }
}

// --- shared helpers ----------------------------------------------------------------------------------------

function checkBody(body) {
  const b = String(body ?? '').trim();
  if (!b) throw new Error('Write a message.');
  if (b.length > MAX_BODY) throw new Error(`Messages are limited to ${MAX_BODY} characters. Split it into two.`);
  return b;
}

/** Every tie-in must belong to the SAME vendor as the thread. Returns the ids to store. */
async function validateTies(q, vendorId, { vendorOrderId, listingId, claimId }) {
  const out = { vendorOrderId: null, listingId: null, claimId: null };
  if (vendorOrderId) {
    const { rows } = await q('SELECT id FROM vendor_orders WHERE id = $1 AND vendor_id = $2', [Number(vendorOrderId), vendorId]);
    if (!rows.length) throw new Error('That order is not one of this seller\'s.');
    out.vendorOrderId = rows[0].id;
  }
  if (listingId) {
    const { rows } = await q('SELECT id FROM marketplace_listings WHERE id = $1 AND vendor_id = $2', [Number(listingId), vendorId]);
    if (!rows.length) throw new Error('That listing is not one of this seller\'s.');
    out.listingId = rows[0].id;
  }
  if (claimId) {
    const { rows } = await q('SELECT id FROM warranty_claims WHERE id = $1 AND vendor_id = $2', [Number(claimId), vendorId]);
    if (!rows.length) throw new Error('That claim is not one of this seller\'s.');
    out.claimId = rows[0].id;
  }
  return out;
}

/** Per-vendor limits, counted from rows (not memory). Serialised per vendor so a burst cannot slip past it. */
async function enforceVendorLimits(q, vendorId, { newThread, now }) {
  await q('SELECT pg_advisory_xact_lock(7331, $1)', [vendorId]);
  const hourAgo = new Date(now.getTime() - 60 * MIN).toISOString();
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM vendor_messages m JOIN vendor_threads t ON t.id = m.thread_id
      WHERE t.vendor_id = $1 AND m.side = 'vendor' AND m.at > $2`, [vendorId, hourAgo]);
  if (rows[0].n >= VENDOR_MESSAGES_PER_HOUR) throw new Error(`You have sent ${VENDOR_MESSAGES_PER_HOUR} messages in the last hour. Please wait a while, or combine your points into one message.`);
  if (newThread) {
    const dayAgo = new Date(now.getTime() - 24 * 60 * MIN).toISOString();
    const { rows: t } = await q(`SELECT count(*)::int AS n FROM vendor_threads WHERE vendor_id = $1 AND started_side = 'vendor' AND created_at > $2`, [vendorId, dayAgo]);
    if (t[0].n >= VENDOR_THREADS_PER_DAY) throw new Error(`You can start up to ${VENDOR_THREADS_PER_DAY} new conversations a day. Please add to an existing one.`);
  }
}

async function insertMessage(q, threadId, { side, internal = false, by, byName, body, now }) {
  await q(`INSERT INTO vendor_messages (thread_id, side, internal, author_email, author_name, body, at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [threadId, side, internal, by, clean(byName, 120) || null, body, now.toISOString()]);
  if (internal) return;
  const col = side === 'vendor' ? 'last_vendor_msg_at' : 'last_staff_msg_at';
  // The writer has, by definition, read the thread up to now.
  const readCol = side === 'vendor' ? 'vendor_read_at' : 'staff_read_at';
  await q(`UPDATE vendor_threads SET ${col} = $2, ${readCol} = $2, last_message_at = $2, last_public_side = $3 WHERE id = $1`, [threadId, now.toISOString(), side]);
}

const needBy = (by) => { if (!by) throw new Error('Who is sending this?'); return String(by).toLowerCase(); };

// --- seller side -------------------------------------------------------------------------------------------

/** A seller starts a conversation. `vendorId` and `by` come from the session. */
export async function startVendorThread(vendorId, { subject, body, vendorOrderId, listingId, claimId, by, byName, now = new Date() }) {
  const author = needBy(by);
  const subj = clean(subject, MAX_SUBJECT);
  if (!subj) throw new Error('Give the conversation a subject.');
  const text = checkBody(body);
  const r = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const ties = await validateTies(q, vendorId, { vendorOrderId, listingId, claimId });
    await enforceVendorLimits(q, vendorId, { newThread: true, now });
    const { rows } = await q(
      `INSERT INTO vendor_threads (vendor_id, subject, vendor_order_id, listing_id, claim_id, started_side, created_by, created_at, last_message_at)
       VALUES ($1,$2,$3,$4,$5,'vendor',$6,$7,$7) RETURNING id`,
      [vendorId, subj, ties.vendorOrderId, ties.listingId, ties.claimId, author, now.toISOString()]);
    await insertMessage(q, rows[0].id, { side: 'vendor', by: author, byName, body: text, now });
    await logVendorEvent(q, vendorId, 'thread_opened', author, { thread: rows[0].id, subject: subj, by: 'vendor' });
    return { id: rows[0].id, subject: subj };
  });
  await notify(r.id, 'staff', { subject: r.subject, now });
  return { ok: true, id: r.id };
}

/** A seller replies. Replying to a closed conversation reopens it. */
export async function replyVendor(vendorId, threadId, { body, by, byName, now = new Date() }) {
  const author = needBy(by);
  const text = checkBody(body);
  const r = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT id, subject, status FROM vendor_threads WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [Number(threadId), vendorId]);
    if (!rows.length) throw new Error('Conversation not found.');
    await enforceVendorLimits(q, vendorId, { newThread: false, now });
    if (rows[0].status === 'closed') {
      await q(`UPDATE vendor_threads SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1`, [rows[0].id]);
      await logVendorEvent(q, vendorId, 'thread_reopened', author, { thread: rows[0].id, by: 'vendor' });
    }
    await insertMessage(q, rows[0].id, { side: 'vendor', by: author, byName, body: text, now });
    return rows[0];
  });
  await notify(r.id, 'staff', { subject: r.subject, now });
  return { ok: true };
}

const TIES_SQL = `
  vo.order_number AS order_number, l.sku AS listing_sku, l.title AS listing_title,
  w.order_number AS claim_order_number, w.sku AS claim_sku`;
const TIES_JOIN = `
  LEFT JOIN vendor_orders vo ON vo.id = t.vendor_order_id
  LEFT JOIN marketplace_listings l ON l.id = t.listing_id
  LEFT JOIN warranty_claims w ON w.id = t.claim_id`;
const tieOf = (r) => ({
  vendorOrderId: r.vendor_order_id || null, orderNumber: r.order_number || null,
  listingId: r.listing_id || null, listingSku: r.listing_sku || null, listingTitle: r.listing_title || null,
  claimId: r.claim_id || null, claimSku: r.claim_sku || null, claimOrderNumber: r.claim_order_number || null
});

/** The seller's inbox. Unread = the staff said something visible to the seller after they last looked. */
export async function listVendorThreads(vendorId) {
  const { rows } = await query(
    `SELECT t.*, ${TIES_SQL},
            (t.last_staff_msg_at IS NOT NULL AND (t.vendor_read_at IS NULL OR t.last_staff_msg_at > t.vendor_read_at)) AS unread,
            (SELECT m.body FROM vendor_messages m WHERE m.thread_id = t.id AND NOT m.internal ORDER BY m.at DESC, m.id DESC LIMIT 1) AS preview
       FROM vendor_threads t ${TIES_JOIN}
      WHERE t.vendor_id = $1 ORDER BY t.last_message_at DESC LIMIT 200`, [vendorId]);
  return rows.map((r) => ({
    id: r.id, subject: r.subject, status: r.status, createdAt: r.created_at, lastMessageAt: r.last_message_at,
    unread: !!r.unread, preview: String(r.preview || '').slice(0, 140), awaitingUs: r.status === 'open' && r.last_public_side === 'staff', tie: tieOf(r)
  }));
}

export async function vendorUnreadCount(vendorId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM vendor_threads
      WHERE vendor_id = $1 AND last_staff_msg_at IS NOT NULL AND (vendor_read_at IS NULL OR last_staff_msg_at > vendor_read_at)`, [vendorId]);
  return rows[0].n;
}

/** One conversation, seller view. Internal notes are excluded IN SQL. Reading marks it read for the seller. */
export async function getVendorThread(vendorId, threadId, { markRead = true, now = new Date() } = {}) {
  const { rows } = await query(
    `SELECT t.*, ${TIES_SQL} FROM vendor_threads t ${TIES_JOIN} WHERE t.id = $1 AND t.vendor_id = $2`, [Number(threadId) || 0, vendorId]);
  const t = rows[0];
  if (!t) return null;
  const { rows: msgs } = await query(
    `SELECT id, side, author_name, body, at FROM vendor_messages WHERE thread_id = $1 AND NOT internal ORDER BY at, id`, [t.id]);
  if (markRead) await query('UPDATE vendor_threads SET vendor_read_at = $2 WHERE id = $1', [t.id, now.toISOString()]);
  return {
    id: t.id, subject: t.subject, status: t.status, createdAt: t.created_at, lastMessageAt: t.last_message_at, tie: tieOf(t),
    messages: msgs.map((m) => ({ id: m.id, mine: m.side === 'vendor', from: m.side === 'vendor' ? (m.author_name || 'Your team') : (m.author_name || 'Bargain Bay'), at: m.at, body: m.body }))
  };
}

/** What a seller can tie a conversation to: their own orders, listings and claims. */
export async function vendorTieOptions(vendorId) {
  const [o, l, c] = await Promise.all([
    query(`SELECT id, order_number FROM vendor_orders WHERE vendor_id = $1 AND status <> 'awaiting_payment' ORDER BY created_at DESC LIMIT 100`, [vendorId]),
    query(`SELECT id, sku, title FROM marketplace_listings WHERE vendor_id = $1 ORDER BY id DESC LIMIT 200`, [vendorId]),
    query(`SELECT id, order_number, sku FROM warranty_claims WHERE vendor_id = $1 ORDER BY opened_at DESC LIMIT 100`, [vendorId])
  ]);
  return {
    orders: o.rows.map((r) => ({ id: r.id, label: r.order_number })),
    listings: l.rows.map((r) => ({ id: r.id, label: `${r.sku}${r.title ? ` — ${r.title}` : ''}` })),
    claims: c.rows.map((r) => ({ id: r.id, label: `Claim on ${r.sku} (${r.order_number})` }))
  };
}

// --- staff side --------------------------------------------------------------------------------------------

function guardContacts(body, internal, confirmContact) {
  if (internal || confirmContact) return;
  const found = contactDetailsIn(body);
  if (found.length) throw new ContactDetailsError(found);
}

/** Staff open a conversation with a seller. */
export async function startStaffThread({ vendorId, subject, body, vendorOrderId, listingId, claimId, by, byName, confirmContact = false, now = new Date() }) {
  const author = needBy(by);
  const subj = clean(subject, MAX_SUBJECT);
  if (!subj) throw new Error('Give the conversation a subject.');
  const text = checkBody(body);
  guardContacts(text, false, confirmContact);
  const r = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows: v } = await q('SELECT id FROM vendors WHERE id = $1', [Number(vendorId) || 0]);
    if (!v.length) throw new Error('No such seller.');
    const ties = await validateTies(q, v[0].id, { vendorOrderId, listingId, claimId });
    const { rows } = await q(
      `INSERT INTO vendor_threads (vendor_id, subject, vendor_order_id, listing_id, claim_id, started_side, created_by, created_at, last_message_at, assigned_to)
       VALUES ($1,$2,$3,$4,$5,'staff',$6,$7,$7,$6) RETURNING id`,
      [v[0].id, subj, ties.vendorOrderId, ties.listingId, ties.claimId, author, now.toISOString()]);
    await insertMessage(q, rows[0].id, { side: 'staff', by: author, byName, body: text, now });
    await logVendorEvent(q, v[0].id, 'thread_opened', author, { thread: rows[0].id, subject: subj, by: 'staff' });
    return { id: rows[0].id, subject: subj };
  });
  await notify(r.id, 'vendor', { subject: r.subject, now });
  return { ok: true, id: r.id };
}

/**
 * Staff reply, or an INTERNAL note the seller never sees. A seller-visible reply on a closed conversation
 * reopens it; an internal note changes nothing about its state.
 */
export async function replyStaff(threadId, { body, internal = false, by, byName, confirmContact = false, now = new Date() }) {
  const author = needBy(by);
  const text = checkBody(body);
  guardContacts(text, !!internal, confirmContact);
  const r = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT id, vendor_id, subject, status FROM vendor_threads WHERE id = $1 FOR UPDATE', [Number(threadId) || 0]);
    if (!rows.length) throw new Error('Conversation not found.');
    if (!internal && rows[0].status === 'closed') {
      await q(`UPDATE vendor_threads SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1`, [rows[0].id]);
      await logVendorEvent(q, rows[0].vendor_id, 'thread_reopened', author, { thread: rows[0].id, by: 'staff' });
    }
    await insertMessage(q, rows[0].id, { side: 'staff', internal: !!internal, by: author, byName, body: text, now });
    return rows[0];
  });
  if (!internal) await notify(r.id, 'vendor', { subject: r.subject, now });
  return { ok: true };
}

export async function assignThread(threadId, { to, by }) {
  needBy(by);
  const who = clean(to, 200).toLowerCase() || null;
  const { rowCount } = await query('UPDATE vendor_threads SET assigned_to = $2 WHERE id = $1', [Number(threadId) || 0, who]);
  if (!rowCount) throw new Error('Conversation not found.');
  return { ok: true };
}

export async function closeThread(threadId, { by, now = new Date() }) {
  const author = needBy(by);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(`UPDATE vendor_threads SET status = 'closed', closed_at = $2, closed_by = $3 WHERE id = $1 AND status = 'open' RETURNING vendor_id`, [Number(threadId) || 0, now.toISOString(), author]);
    if (!rows.length) throw new Error('That conversation is not open.');
    await logVendorEvent(q, rows[0].vendor_id, 'thread_closed', author, { thread: Number(threadId) });
    return { ok: true };
  });
}

export async function reopenThread(threadId, { by }) {
  const author = needBy(by);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(`UPDATE vendor_threads SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1 AND status = 'closed' RETURNING vendor_id`, [Number(threadId) || 0]);
    if (!rows.length) throw new Error('That conversation is not closed.');
    await logVendorEvent(q, rows[0].vendor_id, 'thread_reopened', author, { thread: Number(threadId), by: 'staff' });
    return { ok: true };
  });
}

const FILTERS = {
  open: `t.status = 'open'`,
  awaiting_us: `t.status = 'open' AND t.last_public_side = 'vendor'`,
  awaiting_vendor: `t.status = 'open' AND t.last_public_side = 'staff'`,
  closed: `t.status = 'closed'`,
  all: 'true'
};

/** Staff inbox across every seller. */
export async function listStaffThreads({ filter = 'open', vendorId } = {}) {
  const where = FILTERS[filter] || FILTERS.open;
  const { rows } = await query(
    `SELECT t.*, COALESCE(v.trade_name, v.legal_name) AS vendor, ${TIES_SQL},
            (t.last_vendor_msg_at IS NOT NULL AND (t.staff_read_at IS NULL OR t.last_vendor_msg_at > t.staff_read_at)) AS unread,
            (SELECT m.body FROM vendor_messages m WHERE m.thread_id = t.id AND NOT m.internal ORDER BY m.at DESC, m.id DESC LIMIT 1) AS preview
       FROM vendor_threads t JOIN vendors v ON v.id = t.vendor_id ${TIES_JOIN}
      WHERE ${where} AND ($1::int IS NULL OR t.vendor_id = $1)
      ORDER BY (t.last_public_side = 'vendor' AND t.status = 'open') DESC, t.last_message_at DESC LIMIT 300`, [vendorId || null]);
  return rows.map((r) => ({
    id: r.id, vendorId: r.vendor_id, vendor: r.vendor, subject: r.subject, status: r.status, assignedTo: r.assigned_to,
    lastMessageAt: r.last_message_at, lastPublicSide: r.last_public_side, unread: !!r.unread, preview: String(r.preview || '').slice(0, 140), tie: tieOf(r)
  }));
}

export async function staffUnreadCount() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM vendor_threads
      WHERE status = 'open' AND last_vendor_msg_at IS NOT NULL AND (staff_read_at IS NULL OR last_vendor_msg_at > staff_read_at)`);
  return rows[0].n;
}

/** One conversation, staff view: everything including internal notes. Reading marks it read for staff. */
export async function getStaffThread(threadId, { markRead = true, now = new Date() } = {}) {
  const { rows } = await query(
    `SELECT t.*, COALESCE(v.trade_name, v.legal_name) AS vendor, ${TIES_SQL}
       FROM vendor_threads t JOIN vendors v ON v.id = t.vendor_id ${TIES_JOIN} WHERE t.id = $1`, [Number(threadId) || 0]);
  const t = rows[0];
  if (!t) return null;
  const { rows: msgs } = await query(
    'SELECT id, side, internal, author_email, author_name, body, at FROM vendor_messages WHERE thread_id = $1 ORDER BY at, id', [t.id]);
  if (markRead) await query('UPDATE vendor_threads SET staff_read_at = $2 WHERE id = $1', [t.id, now.toISOString()]);
  return {
    id: t.id, vendorId: t.vendor_id, vendor: t.vendor, subject: t.subject, status: t.status, assignedTo: t.assigned_to,
    createdAt: t.created_at, lastMessageAt: t.last_message_at, lastPublicSide: t.last_public_side, tie: tieOf(t),
    messages: msgs.map((m) => ({ id: m.id, side: m.side, internal: m.internal, from: m.author_name || m.author_email, email: m.author_email, at: m.at, body: m.body }))
  };
}

/** The tie-in choices staff have for one seller (their own orders, listings and claims). */
export const staffTieOptions = vendorTieOptions;

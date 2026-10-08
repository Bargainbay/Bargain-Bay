// Marketplace listings — a vendor's units, from draft to live. See
// docs/marketplace/PLAN.md §7 and db/migrations/0017.
//
// Two kinds of function live here and they are kept strictly apart:
//   * VENDOR functions take `vendorId` (from vendorAccess(), never the request) and
//     put it in every WHERE clause. A listing id belonging to another vendor is
//     indistinguishable from one that does not exist.
//   * STAFF functions (review, check-in) take a listing id and no vendor.
import { query, withTransaction } from './db';
import { canSell } from './marketplace-rules';
import {
  normalizeFields, validateForSubmit, tierProblem, REJECT_REASONS, LISTING_CONDITIONS,
  OCCUPYING_STATUSES, EDITABLE_STATUSES, MAX_PUBLIC_PHOTOS, isSamePicture
} from './listing-rules';

const OCC = OCCUPYING_STATUSES;

// camelCase API field -> column
const COLS = {
  category: 'category', make: 'make', model: 'model', serial: 'serial_private', condition: 'condition',
  title: 'title', description: 'description', price: 'price', compareAt: 'compare_at',
  compareAtSource: 'compare_at_source', widthIn: 'width_in', depthIn: 'depth_in', heightIn: 'height_in',
  weightLb: 'weight_lb', testedWorking: 'tested_working', testNotes: 'test_notes', testedOn: 'tested_on',
  refurbNotes: 'refurb_notes', warrantyMonths: 'warranty_months', deliveryNotes: 'delivery_notes',
  pickupAddress: 'pickup_address', pickupCity: 'pickup_city', pickupPostal: 'pickup_postal', lane: 'lane', attrs: 'attrs'
};

async function logEvent(q, listingId, event, actor, detail = null) {
  await q('INSERT INTO listing_events (listing_id, event, actor, detail) VALUES ($1,$2,$3,$4)',
    [listingId, event, actor || null, detail ? JSON.stringify(detail) : null]);
}

/** Row -> the shape the vendor edits and the validator reads. */
function toListing(r) {
  if (!r) return null;
  const n = (v) => (v == null ? null : Number(v));
  return {
    id: r.id, sku: r.sku, vendorId: r.vendor_id, lane: r.lane, status: r.status,
    category: r.category, make: r.make, model: r.model, serial: r.serial_private, condition: r.condition,
    title: r.title, description: r.description, price: n(r.price), compareAt: n(r.compare_at),
    compareAtSource: r.compare_at_source, widthIn: n(r.width_in), depthIn: n(r.depth_in),
    heightIn: n(r.height_in), weightLb: n(r.weight_lb), testedWorking: r.tested_working,
    testNotes: r.test_notes, testedOn: r.tested_on ? String(r.tested_on).slice(0, 10) : null,
    refurbNotes: r.refurb_notes, warrantyMonths: r.warranty_months, deliveryNotes: r.delivery_notes,
    pickupAddress: r.pickup_address, pickupCity: r.pickup_city, pickupPostal: r.pickup_postal,
    attrs: r.attrs || {}, rejectCode: r.reject_code, reviewNote: r.review_note,
    submittedAt: r.submitted_at, createdAt: r.created_at, updatedAt: r.updated_at
  };
}

async function vendorCanList(q, vendorId) {
  const { rows } = await q('SELECT status, tier FROM vendors WHERE id = $1', [vendorId]);
  if (!rows.length) throw new Error('No such vendor.');
  return rows[0];
}

/**
 * Start a draft. The SKU is `MP-<vendor id>-<nnnn>`, numbered per vendor under a lock so two
 * tabs cannot mint the same one (the SKU is also a product URL, a photo key and a sticker).
 */
export async function createDraft(vendorId, input, { by } = {}) {
  const f = normalizeFields(input);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const v = await vendorCanList(q, vendorId);
    if (!canSell(v.status)) throw new Error('Your account cannot list new units right now.');
    await q('SELECT pg_advisory_xact_lock($1, 7001)', [vendorId]);
    const { rows: m } = await q(
      `SELECT COALESCE(MAX(substring(sku from '[0-9]+$')::int), 0) AS n FROM marketplace_listings WHERE vendor_id = $1`, [vendorId]);
    const sku = `MP-${vendorId}-${String(Number(m[0].n) + 1).padStart(4, '0')}`;
    const lane = f.lane || 'A';
    const { rows } = await q(
      `INSERT INTO marketplace_listings (sku, vendor_id, lane, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [sku, vendorId, ['A', 'B', 'C'].includes(lane) ? lane : 'A', by || null]);
    await logEvent(q, rows[0].id, 'created', by);
    const id = rows[0].id;
    delete f.lane;
    if (Object.keys(f).length) await applyFields(q, id, f);
    return { id, sku };
  });
}

async function applyFields(q, id, f) {
  const sets = [];
  const vals = [id];
  for (const [k, v] of Object.entries(f)) {
    const col = COLS[k];
    if (!col) continue;
    vals.push(k === 'attrs' ? JSON.stringify(v) : v);
    sets.push(`${col} = $${vals.length}${k === 'attrs' ? '::jsonb' : ''}`);
  }
  if (!sets.length) return;
  await q(`UPDATE marketplace_listings SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
}

/**
 * Edit a listing the vendor owns. Free while it is a draft or has changes requested. Once it
 * is in review or for sale the only edit allowed is a LOWER price: any other change would let
 * a vendor get a listing approved and then change what it says.
 */
export async function updateListing(vendorId, listingId, input, { by } = {}) {
  const f = normalizeFields(input);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT * FROM marketplace_listings WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [listingId, vendorId]);
    if (!rows.length) throw new Error('Listing not found.');
    const cur = toListing(rows[0]);
    if (EDITABLE_STATUSES.includes(cur.status)) {
      if (f.lane && f.lane !== cur.lane) { /* lane is checked again at submit */ }
      await applyFields(q, listingId, f);
      await logEvent(q, listingId, 'edited', by, { fields: Object.keys(f) });
      return { ok: true };
    }
    if (['live', 'paused'].includes(cur.status)) {
      const keys = Object.keys(f);
      if (keys.length === 1 && keys[0] === 'price' && f.price > 0 && f.price < cur.price) {
        await applyFields(q, listingId, { price: f.price });
        await logEvent(q, listingId, 'price_lowered', by, { from: cur.price, to: f.price });
        return { ok: true };
      }
      throw new Error('A listing that is for sale can only have its price lowered. Pause it to make other changes — it will be reviewed again.');
    }
    throw new Error(`A listing that is ${cur.status.replace('_', ' ')} cannot be edited.`);
  });
}

/**
 * Attach an already-processed, already-stored photo (see lib/image-checks.js for the checks and
 * the route for the Blob write). `phash` duplicates are reported, not refused here: the same
 * picture on another vendor's listing is a flag for a human, and on this vendor's other listing
 * it is just a vendor photographing identical units.
 */
export async function attachPhoto(vendorId, listingId, p) {
  return withTransaction(async (c) => {
    const q = (t, x) => c.query(t, x);
    const { rows } = await q('SELECT id, status FROM marketplace_listings WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [listingId, vendorId]);
    if (!rows.length) throw new Error('Listing not found.');
    if (!EDITABLE_STATUSES.includes(rows[0].status)) throw new Error('Photos can only be changed while the listing is a draft or has changes requested.');
    const evidence = p.role === 'plate';
    const kind = evidence ? 'evidence' : 'public';
    const { rows: cnt } = await q(
      `SELECT count(*) FILTER (WHERE kind='public')::int AS pub, COALESCE(MAX(position), -1) AS maxpos
         FROM listing_photos WHERE listing_id = $1`, [listingId]);
    if (!evidence && cnt[0].pub >= MAX_PUBLIC_PHOTOS) throw new Error(`A listing holds at most ${MAX_PUBLIC_PHOTOS} photos.`);
    if (evidence) await q(`DELETE FROM listing_photos WHERE listing_id = $1 AND role = 'plate'`, [listingId]); // one plate photo, replaced
    const { rows: ins } = await q(
      `INSERT INTO listing_photos (listing_id, kind, role, blob_path, position, caption, width, height, bytes, phash, blur, warnings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [listingId, kind, p.role, p.blobPath, Number(cnt[0].maxpos) + 1, p.caption || null, p.width || null,
       p.height || null, p.bytes || null, p.phash || null, p.blur ?? null, p.warnings ? JSON.stringify(p.warnings) : null]);
    // The same picture on ANOTHER vendor's listing is a flag for a human (a lifted photo, or one unit
    // listed twice). On this vendor's own other listings it is just a vendor photographing identical units.
    let similar = false;
    if (p.phash) {
      const { rows: others } = await q(
        `SELECT ph.phash FROM listing_photos ph JOIN marketplace_listings l ON l.id = ph.listing_id
          WHERE ph.phash IS NOT NULL AND l.vendor_id <> $1 AND length(ph.phash) = $2
          ORDER BY ph.id DESC LIMIT 20000`, [vendorId, p.phash.length]);
      similar = others.some((o) => isSamePicture(o.phash, p.phash));
    }
    return { id: ins[0].id, kind, similarElsewhere: similar };
  });
}

/** Remove one of the vendor's own photos from a listing they can still edit. Returns the blob path to delete. */
export async function removePhoto(vendorId, listingId, photoId) {
  const { rows } = await query(
    `DELETE FROM listing_photos ph USING marketplace_listings l
      WHERE ph.id = $3 AND ph.listing_id = l.id AND l.id = $2 AND l.vendor_id = $1
        AND l.status IN ('draft','changes_requested') RETURNING ph.blob_path`, [vendorId, listingId, photoId]);
  if (!rows.length) throw new Error('Photo not found, or the listing can no longer be edited.');
  return { blobPath: rows[0].blob_path };
}

async function photoSet(q, listingId) {
  const { rows } = await q('SELECT id, kind, role, position, caption, width, height FROM listing_photos WHERE listing_id = $1 ORDER BY position, id', [listingId]);
  return rows;
}

/** The vendor's completeness check: everything still stopping a submit. Never writes. */
export async function checkListing(vendorId, listingId) {
  const { rows } = await query('SELECT * FROM marketplace_listings WHERE id = $1 AND vendor_id = $2', [listingId, vendorId]);
  if (!rows.length) throw new Error('Listing not found.');
  const l = toListing(rows[0]);
  const photos = await photoSet(query, listingId);
  return { problems: validateForSubmit(l, photos) };
}

/**
 * Send a draft for review. Refused with the full list of what's wrong, not the first thing.
 * Probation vendors are Lane A only and capped; the serial may not already be in play.
 */
export async function submitListing(vendorId, listingId, { by } = {}) {
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const v = await vendorCanList(q, vendorId);
    if (!canSell(v.status)) throw new Error('Your account cannot list new units right now.');
    const { rows } = await q('SELECT * FROM marketplace_listings WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [listingId, vendorId]);
    if (!rows.length) throw new Error('Listing not found.');
    const l = toListing(rows[0]);
    if (!EDITABLE_STATUSES.includes(l.status)) throw new Error(`This listing is already ${l.status.replace('_', ' ')}.`);
    const problems = validateForSubmit(l, await photoSet(q, listingId));
    const { rows: occ } = await q(
      `SELECT count(*)::int AS n FROM marketplace_listings WHERE vendor_id = $1 AND status = ANY($2)`, [vendorId, OCC]);
    const tp = tierProblem(v.tier, l.lane, occ[0].n);
    if (tp) problems.push({ field: 'lane', text: tp });
    if (problems.length) return { ok: false, problems };
    try {
      await q(`UPDATE marketplace_listings SET status='in_review', submitted_at=now(), updated_at=now(),
                      reject_code=NULL, review_note=NULL WHERE id = $1`, [listingId]);
    } catch (e) {
      if (e.code === '23505' || /marketplace_listings_serial_live|duplicate key/.test(e.message || '')) {
        return { ok: false, problems: [{ field: 'serial', text: 'This serial number is already listed. If you think that is a mistake, contact us — we do not say who else has it.' }] };
      }
      throw e;
    }
    await logEvent(q, listingId, 'submitted', by);
    return { ok: true, status: 'in_review' };
  });
}

/** Take a live listing off sale (vendor out of stock, or about to edit it). Free — it is not a cancellation. */
export async function pauseListing(vendorId, listingId, { by } = {}) {
  const { rowCount } = await query(
    `UPDATE marketplace_listings SET status='paused', updated_at=now() WHERE id=$1 AND vendor_id=$2 AND status='live'`, [listingId, vendorId]);
  if (!rowCount) throw new Error('Only a live listing can be paused.');
  await logEvent(query, listingId, 'paused', by);
  return { ok: true };
}

/** Put it back on sale, but only if the vendor may still sell — a restricted vendor stays paused. */
export async function resumeListing(vendorId, listingId, { by } = {}) {
  const v = await vendorCanList(query, vendorId);
  if (!canSell(v.status)) throw new Error('Your account cannot put listings on sale right now.');
  const { rowCount } = await query(
    `UPDATE marketplace_listings SET status='live', updated_at=now() WHERE id=$1 AND vendor_id=$2 AND status='paused'`, [listingId, vendorId]);
  if (!rowCount) throw new Error('Only a paused listing can be resumed.');
  await logEvent(query, listingId, 'resumed', by);
  return { ok: true };
}

/** Edit-after-live path: pause, change anything, and it goes back through review. */
export async function reopenForEdit(vendorId, listingId, { by } = {}) {
  const { rowCount } = await query(
    `UPDATE marketplace_listings SET status='draft', updated_at=now() WHERE id=$1 AND vendor_id=$2 AND status='paused'`, [listingId, vendorId]);
  if (!rowCount) throw new Error('Pause the listing first.');
  await logEvent(query, listingId, 'reopened', by);
  return { ok: true };
}

export async function withdrawListing(vendorId, listingId, { by } = {}) {
  const { rowCount } = await query(
    `UPDATE marketplace_listings SET status='withdrawn', updated_at=now()
      WHERE id=$1 AND vendor_id=$2 AND status IN ('draft','changes_requested','in_review','approved','awaiting_checkin','live','paused')`,
    [listingId, vendorId]);
  if (!rowCount) throw new Error('This listing cannot be withdrawn (it may be reserved or sold).');
  await logEvent(query, listingId, 'withdrawn', by);
  return { ok: true };
}

// --- reads (vendor-scoped) ---------------------------------------------------

export async function listVendorListings(vendorId, { status } = {}) {
  const { rows } = await query(
    `SELECT l.*, (SELECT count(*) FROM listing_photos p WHERE p.listing_id = l.id AND p.kind = 'public')::int AS photo_count
       FROM marketplace_listings l WHERE l.vendor_id = $1 AND ($2::text IS NULL OR l.status = $2)
      ORDER BY l.updated_at DESC LIMIT 500`, [vendorId, status || null]);
  return rows.map((r) => ({ ...toListing(r), photoCount: r.photo_count }));
}

export async function getVendorListing(vendorId, listingId) {
  const { rows } = await query('SELECT * FROM marketplace_listings WHERE id = $1 AND vendor_id = $2', [listingId, vendorId]);
  if (!rows.length) return null;
  return { ...toListing(rows[0]), photos: await photoSet(query, listingId) };
}

// --- staff -------------------------------------------------------------------

/** The review queue, oldest first. Probation vendors' listings are always here. */
export async function reviewQueue() {
  const { rows } = await query(
    `SELECT l.id, l.sku, l.title, l.make, l.model, l.condition, l.price, l.lane, l.submitted_at,
            v.id AS vendor_id, COALESCE(v.trade_name, v.legal_name) AS vendor, v.tier
       FROM marketplace_listings l JOIN vendors v ON v.id = l.vendor_id
      WHERE l.status = 'in_review' ORDER BY l.submitted_at`);
  return rows;
}

/** Staff opens a listing in full, including the private serial and the evidence photos. */
export async function getListingForReview(listingId) {
  const { rows } = await query('SELECT * FROM marketplace_listings WHERE id = $1', [listingId]);
  if (!rows.length) return null;
  return { ...toListing(rows[0]), photos: await photoSet(query, listingId) };
}

/**
 * A staff decision on a listing in review.
 *   approve  -> Lane A waits for check-in at our warehouse; B and C go live.
 *   changes  -> back to the vendor with a note; they fix it and resubmit.
 *   reject   -> closed, with a reason from the fixed list.
 * Staff may re-grade the condition on approval (the vendor's grade is a claim, not a fact);
 * the change is recorded.
 */
export async function reviewListing(listingId, { decision, by, note, reason, condition }) {
  if (!by) throw new Error('Who is reviewing this?');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT * FROM marketplace_listings WHERE id = $1 FOR UPDATE', [listingId]);
    if (!rows.length) throw new Error('Listing not found.');
    const l = toListing(rows[0]);
    if (l.status !== 'in_review') throw new Error(`This listing is ${l.status.replace('_', ' ')}, not in review.`);
    if (decision === 'approve') {
      const { rows: v } = await q('SELECT status FROM vendors WHERE id = $1', [l.vendorId]);
      if (!canSell(v[0]?.status)) throw new Error('This vendor can no longer sell, so the listing cannot be approved.');
      let cond = l.condition;
      if (condition && condition !== l.condition) {
        if (!LISTING_CONDITIONS.includes(condition)) throw new Error('That is not a valid condition.');
        cond = condition;
        await logEvent(q, listingId, 'regraded', by, { from: l.condition, to: condition });
      }
      const next = l.lane === 'A' ? 'awaiting_checkin' : 'live';
      await q(`UPDATE marketplace_listings SET status=$2, condition=$3, reviewed_at=now(), reviewed_by=$4, review_note=$5, updated_at=now() WHERE id=$1`,
        [listingId, next, cond, by, note || null]);
      await logEvent(q, listingId, 'approved', by, { status: next });
      return { ok: true, status: next };
    }
    if (decision === 'changes') {
      if (!String(note || '').trim()) throw new Error('Tell the vendor what to change.');
      await q(`UPDATE marketplace_listings SET status='changes_requested', reviewed_at=now(), reviewed_by=$2, review_note=$3, updated_at=now() WHERE id=$1`,
        [listingId, by, String(note).trim()]);
      await logEvent(q, listingId, 'changes_requested', by, { note });
      return { ok: true, status: 'changes_requested' };
    }
    if (decision === 'reject') {
      if (!REJECT_REASONS[reason]) throw new Error('Choose a rejection reason from the list.');
      if (reason === 'other' && !String(note || '').trim()) throw new Error('"Other" needs an explanation.');
      await q(`UPDATE marketplace_listings SET status='rejected', reject_code=$2, reviewed_at=now(), reviewed_by=$3, review_note=$4, updated_at=now() WHERE id=$1`,
        [listingId, reason, by, note || null]);
      await logEvent(q, listingId, 'rejected', by, { reason, note: note || null });
      return { ok: true, status: 'rejected' };
    }
    throw new Error('Decision must be approve, changes or reject.');
  });
}

/**
 * Lane A: the unit has arrived. Accepted puts it on sale; rejected closes the listing and the
 * unit goes back to the vendor. "The customer never buys something that isn't physically in our
 * building" is why listing and check-in are separate steps.
 */
export async function checkInListing(listingId, { by, accepted, note }) {
  if (!by) throw new Error('Who checked it in?');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT status, vendor_id FROM marketplace_listings WHERE id = $1 FOR UPDATE', [listingId]);
    if (!rows.length) throw new Error('Listing not found.');
    if (rows[0].status !== 'awaiting_checkin') throw new Error('This listing is not waiting for check-in.');
    if (accepted) {
      const { rows: v } = await q('SELECT status FROM vendors WHERE id = $1', [rows[0].vendor_id]);
      if (!canSell(v[0]?.status)) throw new Error('This vendor can no longer sell; hold the unit and speak to an admin.');
    } else if (!String(note || '').trim()) throw new Error('Say why the unit was not accepted.');
    await q(`UPDATE marketplace_listings SET status=$2, review_note=COALESCE($3, review_note), updated_at=now() WHERE id=$1`,
      [listingId, accepted ? 'live' : 'rejected', note || null]);
    await logEvent(q, listingId, accepted ? 'checked_in' : 'checkin_refused', by, { note: note || null });
    return { ok: true, status: accepted ? 'live' : 'rejected' };
  });
}

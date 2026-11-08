// A rep's hold on a unit: the customer is deciding, nobody else may buy it.
//
// It is an ordinary reservation row with NO order, so the storefront, checkout and
// invoices already honour it (unavailableSkus), and expireReservations already clears
// an expired row with no order. What this adds is who placed it and a hard ceiling on
// how long — 48 hours — because an open-ended hold is how a one-of-a-kind unit goes
// missing from the site for weeks.
//
// Claimed with the same race-safe upsert as checkout: it only steals a row that has
// already expired, so two reps (or a rep and a checkout) cannot both win.
import { hasDb, query } from './db';
import { unavailableSkus } from './reservations';

export const MAX_HOLD_HOURS = 48;
export class HoldError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}

const norm = (e) => String(e || '').trim().toLowerCase();

export async function holdForRep(sku, { hours = MAX_HOLD_HOURS, note = '' } = {}, viewer) {
  if (!hasDb()) throw new HoldError('Database not configured.', 'nodb');
  const id = String(sku || '').trim();
  if (!id) throw new HoldError('Which unit?');
  const h = Math.min(Math.max(Math.round(Number(hours) || MAX_HOLD_HOURS), 1), MAX_HOLD_HOURS);

  const { rows: p } = await query(`SELECT sku FROM products WHERE upper(sku) = upper($1) AND active = true AND sold_at IS NULL`, [id])
    .catch(() => ({ rows: [] }));
  if (!p[0]) throw new HoldError('That unit is not for sale right now.', 'unavailable');
  const real = p[0].sku;
  if ((await unavailableSkus([real])).has(real)) throw new HoldError('That unit is already held or sold.', 'held');

  const { rowCount } = await query(
    `INSERT INTO reservations (sku, order_id, expires_at, held_by, hold_note)
     VALUES ($1, NULL, now() + ($2 || ' hours')::interval, $3, $4)
     ON CONFLICT (sku) DO UPDATE
       SET order_id = NULL, expires_at = EXCLUDED.expires_at, held_by = EXCLUDED.held_by, hold_note = EXCLUDED.hold_note
       WHERE reservations.expires_at < now()`,
    [real, String(h), norm(viewer?.email) || null, String(note || '').trim().slice(0, 200) || null]
  );
  if (!rowCount) throw new HoldError('That unit is already held or sold.', 'held');
  return { ok: true, sku: real, hours: h };
}

/** A rep releases their own hold; an admin may release any rep hold. An ORDER's reservation is never touched here. */
export async function releaseRepHold(sku, viewer) {
  if (!hasDb()) throw new HoldError('Database not configured.', 'nodb');
  const params = [String(sku || '').trim()];
  let who = '';
  if (!viewer?.admin) { params.push(norm(viewer?.email)); who = ` AND lower(held_by) = $2`; }
  const { rowCount } = await query(
    `DELETE FROM reservations WHERE upper(sku) = upper($1) AND order_id IS NULL AND held_by IS NOT NULL${who}`, params);
  if (!rowCount) throw new HoldError('You have no hold on that unit.', 'notfound');
  return { ok: true };
}

export async function listRepHolds(viewer) {
  if (!hasDb()) return [];
  const params = [];
  let where = `WHERE r.order_id IS NULL AND r.held_by IS NOT NULL AND r.expires_at > now()`;
  if (!viewer?.admin) { params.push(norm(viewer?.email)); where += ` AND lower(r.held_by) = $1`; }
  const { rows } = await query(
    `SELECT r.sku, r.held_by, r.hold_note, r.expires_at, p.make, p.model, p.title, p.price
       FROM reservations r LEFT JOIN products p ON upper(p.sku) = upper(r.sku)
       ${where} ORDER BY r.expires_at`, params).catch(() => ({ rows: [] }));
  return rows;
}

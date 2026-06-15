// Clearance layer on Postgres. A clearance row marks a unit down and shortens
// (warranty stays the standard one year). Layered onto the catalog at render time,
// exactly like reservations — degrades gracefully to "no clearance" with no DB.
import { query, hasDb } from './db';
import { getAll, getById } from './inventory';

export const DEFAULT_CLEARANCE_WARRANTY = 12;

// Map of sku -> { price, warrantyMonths, note } for ACTIVE clearance rows.
export async function clearanceMap() {
  if (!hasDb()) return new Map();
  try {
    const { rows } = await query(
      `SELECT sku, price, warranty_months, note FROM clearance WHERE active = true`
    );
    return new Map(
      rows.map((r) => [
        r.sku,
        { price: Number(r.price), warrantyMonths: r.warranty_months, note: r.note || '' }
      ])
    );
  } catch (e) {
    console.error('clearanceMap failed (no clearance applied):', e.message);
    return new Map();
  }
}

// Merge a clearance record onto a catalog unit. Keeps the original selling
// price as preClearancePrice; compareAt stays the retail strike-through.
export function applyClearance(unit, rec) {
  if (!unit || !rec) return unit;
  return {
    ...unit,
    onClearance: true,
    preClearancePrice: unit.price,
    price: rec.price,
    compareAt: unit.compareAt && unit.compareAt > rec.price ? unit.compareAt : unit.price,
    warrantyMonths: rec.warrantyMonths || DEFAULT_CLEARANCE_WARRANTY,
    clearanceNote: rec.note || ''
  };
}

// Decorate a list of units with any active clearance markdowns (one DB read).
export async function decorate(units) {
  const map = await clearanceMap();
  if (!map.size) return units;
  return units.map((u) => (map.has(u.id) ? applyClearance(u, map.get(u.id)) : u));
}

// Decorate a single unit (product page).
export async function decorateOne(unit) {
  if (!unit) return unit;
  const map = await clearanceMap();
  return map.has(unit.id) ? applyClearance(unit, map.get(unit.id)) : unit;
}

// All available units currently on clearance (for the /clearance page).
// `available` is the already-availability-filtered unit list from the caller.
export async function clearanceUnits(available) {
  const map = await clearanceMap();
  if (!map.size) return [];
  return available
    .filter((u) => map.has(u.id))
    .map((u) => applyClearance(u, map.get(u.id)));
}

// ---- Admin helpers -------------------------------------------------------

// All clearance rows (active + inactive) joined with catalog info for the panel.
export async function listClearanceAdmin() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT sku, price, warranty_months, note, active, updated_at
       FROM clearance ORDER BY updated_at DESC`
  );
  return rows.map((r) => {
    const u = getById(r.sku);
    return {
      sku: r.sku,
      price: Number(r.price),
      warrantyMonths: r.warranty_months,
      note: r.note || '',
      active: r.active,
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      title: u ? (u.title || `${u.make} ${u.model}`) : '(not in current catalog)',
      make: u ? u.make : '',
      model: u ? u.model : '',
      category: u ? u.category : '',
      retail: u ? u.compareAt : null,
      listPrice: u ? u.price : null
    };
  });
}

// Search the catalog so the admin can find a unit to mark down.
export function searchCatalog(q, limit = 25) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return [];
  return getAll()
    .filter((u) =>
      [u.id, u.make, u.model, u.title, u.category].join(' ').toLowerCase().includes(term)
    )
    .slice(0, limit)
    .map((u) => ({
      sku: u.id,
      title: u.title || `${u.make} ${u.model}`,
      make: u.make,
      model: u.model,
      category: u.category,
      retail: u.compareAt,
      listPrice: u.price
    }));
}

export async function upsertClearance({ sku, price, warrantyMonths, note, active }) {
  if (!hasDb()) throw new Error('Database not configured');
  const wm = Number.isFinite(+warrantyMonths) ? Math.max(0, Math.round(+warrantyMonths)) : DEFAULT_CLEARANCE_WARRANTY;
  const { rows } = await query(
    `INSERT INTO clearance (sku, price, warranty_months, note, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (sku) DO UPDATE
       SET price = EXCLUDED.price, warranty_months = EXCLUDED.warranty_months,
           note = EXCLUDED.note, active = EXCLUDED.active, updated_at = now()
     RETURNING sku`,
    [sku, price, wm, note || null, active !== false]
  );
  return rows[0];
}

export async function removeClearance(sku) {
  if (!hasDb()) throw new Error('Database not configured');
  const { rowCount } = await query('DELETE FROM clearance WHERE sku = $1', [sku]);
  return rowCount;
}

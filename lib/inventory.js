// Catalog access. Source of truth is the Postgres `products` table (synced from
// the master tracker by /api/admin/sync-inventory). Falls back to the committed
// data/catalog.json snapshot when the table is empty or the DB is unavailable,
// so the storefront keeps working before the first sync. Availability
// (sold / reserved) is layered on from Postgres by lib/reservations.
import catalogFile from '../data/catalog.json';
import { imageFor } from './images';
import { withRsopsPhotos, withRsopsPhotosOne } from './rsops';
import { unavailableSkus } from './reservations';
import { hasDb, query } from './db';

const fileUnits = Array.isArray(catalogFile) ? catalogFile : catalogFile.units || [];

const COLS = `sku AS id, make, model, category, title, condition,
              price, compare_at AS "compareAt", cost, uid, image_url AS "imageUrl"`;
const num = (u) => ({
  ...u,
  price: u.price == null ? 0 : Number(u.price),
  compareAt: u.compareAt == null ? 0 : Number(u.compareAt),
  cost: u.cost == null ? 0 : Number(u.cost)
});

// True once the products table has at least one row (i.e. a sync has run).
async function dbPopulated() {
  if (!hasDb()) return false;
  try {
    const { rows } = await query('SELECT 1 FROM products LIMIT 1');
    return rows.length > 0;
  } catch {
    return false;
  }
}

// Active inventory units (DB when synced, else the file snapshot). Exported so
// other modules (analytics) share one source without circular imports.
// opts.strict: for agent/inventory-truth reads (Sarah). When a DB is configured
// but the read fails or is empty, throw / return empty instead of silently
// serving the stale committed catalog.json — otherwise Sarah would confidently
// report months-old inventory (e.g. "no Blomberg") as if it were current. The
// storefront keeps the lenient fallback so it degrades gracefully for shoppers.
export async function loadUnits({ strict = false } = {}) {
  if (hasDb()) {
    // Retry once — the read can transiently fail under DB-pool pressure (e.g. a
    // busy Telegram turn firing many queries); a blip shouldn't drop Sarah to the
    // stale snapshot or make her say inventory is unavailable.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { rows } = await query(`SELECT ${COLS} FROM products WHERE active = true ORDER BY position ASC, sku ASC`);
        if (rows.length) return rows.map(num);
        if (strict) return []; // populated system briefly empty — be honest, don't serve the old file
        return fileUnits;      // pre-first-sync bootstrap (storefront only)
      } catch (e) {
        console.error(`products load failed (attempt ${attempt + 1}):`, e.message);
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 150)); continue; }
        if (strict) throw new Error('live inventory read failed');
        console.error('  → falling back to catalog.json (storefront only)');
      }
    }
  }
  return fileUnits;
}

export async function getAll(opts = {}) {
  const units = await loadUnits(opts);
  // RS Ops real unit photos override catalog/stock images (soft-fails to no-op).
  return withRsopsPhotos(units.map((u) => ({ ...u, image: imageFor(u) })));
}

// Single unit by SKU — returns it even if inactive (so a just-sold unit's page
// can still render with a "Sold" badge). DB authoritative once synced.
export async function getById(id) {
  if (hasDb()) {
    try {
      const { rows } = await query(`SELECT ${COLS} FROM products WHERE sku = $1`, [id]);
      if (rows.length) { const u = num(rows[0]); return withRsopsPhotosOne({ ...u, image: imageFor(u) }); }
      if (await dbPopulated()) return null; // synced + not found = genuinely gone
    } catch (e) {
      console.error('getById failed, using catalog.json:', e.message);
    }
  }
  const u = fileUnits.find((x) => x.id === id);
  return u ? withRsopsPhotosOne({ ...u, image: imageFor(u) }) : null;
}

// Used by checkout — only ACTIVE units, so a deactivated (sold-elsewhere) SKU
// can never be purchased online.
export async function getMany(ids) {
  if (hasDb()) {
    try {
      const { rows } = await query(`SELECT ${COLS} FROM products WHERE active = true AND sku = ANY($1)`, [ids]);
      if (rows.length || (await dbPopulated())) return rows.map((r) => { const u = num(r); return { ...u, image: imageFor(u) }; });
    } catch (e) {
      console.error('getMany failed, using catalog.json:', e.message);
    }
  }
  const byId = new Map(fileUnits.map((u) => [u.id, u]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((u) => ({ ...u, image: imageFor(u) }));
}

// All units purchasable right now (minus reserved/sold).
export async function getAvailable() {
  const all = await getAll();
  const blocked = await unavailableSkus();
  return all.filter((u) => !blocked.has(u.id));
}

// Other available units of the same make+model (for the "more units of this
// model" list on a product page). Case-insensitive match, excludes the unit
// being viewed. Returns decorated-with-image units, cheapest first.
const sameModel = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
export async function getSiblings(make, model, excludeId, limit = 8) {
  if (!make || !model) return [];
  const all = await getAvailable();
  return all
    .filter((u) => u.id !== excludeId && sameModel(u.make, make) && sameModel(u.model, model))
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);
}

// Last N units in catalog order = most recently added lots.
export function newestArrivals(all, n = 12) {
  return [...all].slice(-n).reverse();
}

export function categories(list = []) {
  return [...new Set(list.map((u) => u.category))].sort();
}

export function brands(list = []) {
  return [...new Set(list.map((u) => u.make))].sort();
}

// The list the sales floor works down: every unit on sale that has no picture of
// the actual machine yet.
//
// "Has a photo" means what the product page shows after the stock picture — our
// own (`photos`, lib/unit-photos) or RS Ops's inspection set (`rsopsPhotos`).
// A unit RS Ops already photographed is NOT on the list; asking sales to shoot
// it again is work with no new information on the page.
//
// Marketplace sellers' and Vesta units are never listed: getAvailable() is
// called without { marketplace: true }, and we cannot photograph their stock.
import { getAvailable } from './inventory';
import { currentLocations } from './locations';
import { MAX_PHOTOS } from './unit-photos';
import { hasDb, query } from './db';
import { unavailableSkus } from './reservations';

export const hasRealPhotos = (u) => (u.photos?.length || 0) + (u.rsopsPhotos?.length || 0) > 0;

// Pure, so the screen's numbers can be tested without a database.
export function photoQueue(units) {
  const list = Array.isArray(units) ? units : [];
  const todo = list.filter((u) => !hasRealPhotos(u));
  return { total: list.length, withPhotos: list.length - todo.length, todo };
}

export async function unitsNeedingPhotos() {
  const { total, withPhotos, todo } = photoQueue(await getAvailable());
  // The spot is a convenience (it saves a walk round the warehouse). If the
  // locations tables can't be read the list is still correct without it.
  let spots = new Map();
  try { spots = await currentLocations(todo.map((u) => u.id)); } catch { /* no spots */ }
  const units = todo.map((u) => ({
    sku: u.id,
    make: u.make || '',
    model: u.model || '',
    title: u.title || '',
    category: u.category || '',
    condition: u.condition || '',
    image: u.image || null,
    spot: spots.get(u.id)?.code || null,
  }));
  // Group-friendly order: same make+model sit together, so one trip to the rack
  // photographs a run of identical-looking fridges.
  units.sort((a, b) => `${a.make} ${a.model} ${a.sku}`.localeCompare(`${b.make} ${b.model} ${b.sku}`));
  return { total, withPhotos, units, max: MAX_PHOTOS };
}

// ---- Choosing the unit a photo belongs to --------------------------------------
//
// Photos are stored against a SKU, and a SKU typed by hand is a SKU typed wrong:
// on 2026-11-04 two photos went in under the MODEL number (PRFS2883AF) and sat
// there, saved and loading fine, attached to nothing. So the screen offers units
// to PICK, and the upload route refuses anything that is not one.
//
// "A unit" means a unit on the AVAILABLE list — the same test the shop uses
// (getAvailable): active on the site and neither sold nor held by an order or a
// checkout. A sold unit's photos help nobody, and a held one is on its way out.

// Of these SKUs, the ones the shop would show. `unavailableSkus` is the shop's own
// rule; it fails open (returns nothing blocked) if its tables cannot be read.
async function stillAvailable(skus) {
  if (!skus.length) return new Set();
  const blocked = await unavailableSkus(skus);
  return new Set(skus.filter((k) => !blocked.has(k)));
}

// Every word typed must appear somewhere in the unit's sku / make / model / title /
// category, so "frigidaire 2883" finds the fridge. Soft-fails to no matches.
export async function findUnits(q, limit = 12) {
  const words = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!hasDb() || !words.length) return [];
  const pats = words.map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`);
  const hay = "concat_ws(' ', p.sku, p.make, p.model, p.title, p.category)";
  const want = Math.min(Number(limit) || 12, 30);
  // Over-fetch, then drop the sold/held ones, so a run of held units cannot crowd out a free one.
  const fetchN = want * 4;
  let rows;
  try {
    ({ rows } = await query(
      `SELECT p.sku, p.make, p.model, p.category, p.condition, COALESCE(n.c, 0)::int AS photos
         FROM products p
         LEFT JOIN (SELECT sku, COUNT(*) AS c FROM unit_photos GROUP BY sku) n ON n.sku = p.sku
        WHERE p.active = true AND ${hay} ILIKE ALL($1)
        ORDER BY (lower(p.sku) = lower($2)) DESC, p.make, p.model, p.sku
        LIMIT ${fetchN}`,
      [pats, words.join(' ')]
    ));
  } catch {
    try { // unit_photos not created yet: still offer the units
      ({ rows } = await query(
        `SELECT p.sku, p.make, p.model, p.category, p.condition, 0 AS photos FROM products p
          WHERE p.active = true AND ${hay} ILIKE ALL($1) ORDER BY p.make, p.model, p.sku LIMIT ${fetchN}`, [pats]));
    } catch { return []; }
  }
  const ok = await stillAvailable(rows.map((r) => r.sku));
  return rows.filter((r) => ok.has(r.sku)).slice(0, want);
}

// What a typed SKU really is. Returns { sku } (the SKU exactly as the products
// table spells it, so "ss-117082-022" and " SS-117082-022" both land on the one
// real unit) or { error } saying what to do instead. A model number gets the
// available units of that model, because that is the mistake this exists for.
export async function resolveUnitSku(raw) {
  const typed = String(raw || '').trim();
  if (!typed) return { error: 'Choose the unit these photos are for.' };
  if (!hasDb()) return { error: 'Database not configured (POSTGRES_URL).' };
  try {
    const hit = await query('SELECT sku, active FROM products WHERE lower(sku) = lower($1) LIMIT 1', [typed]);
    if (hit.rows.length) {
      const { sku, active } = hit.rows[0];
      if (active && (await stillAvailable([sku])).has(sku)) return { sku };
      return { error: `${sku} is not on the available inventory list (it is sold, on hold or off the site), so it can't take photos. Pick a unit from the list.` };
    }
    const byModel = await query(
      'SELECT sku FROM products WHERE active = true AND lower(model) = lower($1) ORDER BY sku LIMIT 40', [typed]);
    if (byModel.rows.length) {
      const free = [...(await stillAvailable(byModel.rows.map((r) => r.sku)))].slice(0, 8);
      return { error: free.length
        ? `"${typed}" is a model number, not a unit. Pick the exact unit: ${free.join(', ')}.`
        : `"${typed}" is a model number, and none of its units are available right now.` };
    }
    return { error: `No unit with the SKU "${typed}" is on the available inventory list. Pick one from the list. If it was only just booked in, press Sync inventory first.` };
  } catch (e) {
    return { error: 'Could not check that SKU just now. Try again.' };
  }
}

// Package deals — a washer + dryer pair, or a whole kitchen — sold at one price.
//
// A bundle names specific SKUs (stock is one-of-a-kind) and a package price. It
// is live only while EVERY unit in it is still for sale; the moment one sells the
// package disappears rather than advertising something checkout would refuse.
//
// How the price reaches an order: as an automatic discount. When a cart holds
// every unit of a bundle, the discount is (those units' current prices) minus
// the package price, and it competes with a typed code or automatic promotion on
// the same terms — the shopper gets whichever is worth more, never both. It is
// recomputed in /api/checkout from authoritative prices; the storefront figure is
// only a preview. Because it is a DIFFERENCE against live prices, a member whose
// own prices are already below the package price simply gets no extra discount —
// a member never pays more than a regular shopper, and never less than the floor.
import { query, hasDb } from './db';
import { round2 } from './constants';
import { consignmentFloors } from './consignment';

export const BUNDLE_CODE_PREFIX = 'BUNDLE-';
export const bundleCode = (id) => `${BUNDLE_CODE_PREFIX}${id}`;

const shape = (r, skus) => ({
  id: r.id,
  title: r.title,
  blurb: r.blurb || '',
  price: Number(r.price) || 0,
  active: !!r.active,
  skus
});

async function load({ onlyActive = false } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(`SELECT * FROM bundles ${onlyActive ? 'WHERE active' : ''} ORDER BY id DESC`);
  if (!rows.length) return [];
  const items = await query('SELECT bundle_id, sku FROM bundle_items ORDER BY bundle_id, position');
  const by = new Map();
  for (const i of items.rows) {
    if (!by.has(i.bundle_id)) by.set(i.bundle_id, []);
    by.get(i.bundle_id).push(i.sku);
  }
  return rows.map((r) => shape(r, by.get(r.id) || []));
}

// Admin list. Soft-fails to [] so the page renders before the migration is run.
export async function listBundles() {
  try { return await load(); } catch (e) { console.error('bundles unavailable', e?.message || e); return []; }
}

export async function saveBundle({ id, title, blurb = '', price, skus, active = true }, by = '') {
  if (!hasDb()) throw new Error('Database not configured.');
  const name = String(title || '').trim();
  if (!name) throw new Error('Give the package a name.');
  const list = [...new Set((Array.isArray(skus) ? skus : []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (list.length < 2) throw new Error('A package needs at least two units.');
  if (list.length > 12) throw new Error('A package can hold at most 12 units.');
  const p = round2(Number(price));
  if (!(p > 0)) throw new Error('Enter the package price.');

  // Refuse a package that sells under what the units cost (cost, or cost + 20% for
  // consigned stock). Same stance as clearance: a price nobody should type by accident.
  const { rows } = await query('SELECT sku AS id, cost FROM products WHERE sku = ANY($1) AND active', [list]);
  if (rows.length !== list.length) {
    const known = new Set(rows.map((r) => r.id));
    throw new Error(`Not on the site: ${list.filter((s) => !known.has(s)).join(', ')}`);
  }
  const floors = await consignmentFloors(list);
  const floor = round2(rows.reduce((a, r) => a + Math.max(Number(r.cost) || 0, floors.has(r.id) ? floors.get(r.id).floor : 0), 0));
  if (floor > 0 && p < floor) throw new Error(`That is under the floor for these units (${floor.toFixed(2)}).`);

  const bid = id ? parseInt(id, 10) : null;
  let bundleId = bid;
  if (bid) {
    await query('UPDATE bundles SET title=$2, blurb=$3, price=$4, active=$5 WHERE id=$1', [bid, name, String(blurb).slice(0, 400), p, !!active]);
    await query('DELETE FROM bundle_items WHERE bundle_id = $1', [bid]);
  } else {
    const ins = await query('INSERT INTO bundles (title, blurb, price, active, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, String(blurb).slice(0, 400), p, !!active, by || null]);
    bundleId = ins.rows[0].id;
  }
  for (let i = 0; i < list.length; i++) {
    await query('INSERT INTO bundle_items (bundle_id, sku, position) VALUES ($1,$2,$3)', [bundleId, list[i], i]);
  }
  return bundleId;
}

export async function setBundleActive(id, active) {
  await query('UPDATE bundles SET active = $2 WHERE id = $1', [id, !!active]);
}

export async function deleteBundle(id) {
  await query('DELETE FROM bundles WHERE id = $1', [id]);
}

// The best package a cart earns, or null. `items` are catalogue units (they carry
// `cost`), `priced` is resolvePrices' map. Our own stock only — callers pass
// non-marketplace units. Never throws: a package that can't be worked out is
// simply not offered.
export async function bestBundleDiscount(items, priced) {
  try {
    if (!hasDb() || !items?.length) return null;
    const bundles = await load({ onlyActive: true });
    if (!bundles.length) return null;
    const byId = new Map(items.map((u) => [u.id, u]));
    const priceOf = (u) => Number(priced.get(u.id)?.price ?? u.price) || 0;
    const floors = await consignmentFloors(items.map((u) => u.id));
    let best = null;
    for (const b of bundles) {
      if (b.skus.length < 2 || !b.skus.every((s) => byId.has(s))) continue;
      const units = b.skus.map((s) => byId.get(s));
      const regular = round2(units.reduce((a, u) => a + priceOf(u), 0));
      const wanted = round2(regular - b.price);
      if (wanted <= 0) continue;
      // Each unit gives up at most what it can spare above its floor.
      const room = round2(units.reduce((a, u) => {
        const floor = Math.max(Number(u.cost) || 0, floors.has(u.id) ? floors.get(u.id).floor : 0);
        return a + Math.max(0, priceOf(u) - floor);
      }, 0));
      const discount = round2(Math.min(wanted, room));
      if (discount > 0 && (!best || discount > best.discount)) {
        best = { bundle: b, code: bundleCode(b.id), discount, capped: discount < wanted };
      }
    }
    return best;
  } catch (e) {
    console.error('bundle pricing unavailable', e?.message || e);
    return null;
  }
}

// Storefront: the packages that can be bought right now, with their units and
// what they save against today's prices. `units` are decorated available units.
export async function liveBundles(units) {
  try {
    const bundles = await load({ onlyActive: true });
    const byId = new Map((units || []).map((u) => [u.id, u]));
    const out = [];
    for (const b of bundles) {
      if (b.skus.length < 2 || !b.skus.every((s) => byId.has(s))) continue;
      const parts = b.skus.map((s) => byId.get(s));
      if (parts.some((u) => u.marketplace || u.vesta)) continue;
      const regular = round2(parts.reduce((a, u) => a + (Number(u.price) || 0), 0));
      const save = round2(regular - b.price);
      if (save <= 0) continue;   // nothing to show: the package price is no better than the parts
      out.push({ ...b, units: parts, regular, save });
    }
    return out;
  } catch (e) {
    console.error('live bundles unavailable', e?.message || e);
    return [];
  }
}

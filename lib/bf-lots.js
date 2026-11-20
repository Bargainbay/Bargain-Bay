// The Black Friday doorbusters as a fixed set of LOTS, so a unit that sells stays on the hero as a stamped
// "SOLD OUT" slide until Cyber Monday instead of silently vanishing (owner, 2026-11-18: show the unit, then say sold out).
//
// Pure (imports only lib/bf-hero), tested without a database. The impure half (settings + inventory) is lib/bf-lots-load.js.
//
// A lot is a snapshot of what the shopper saw: make, model, title, photo, the price and the retail. Sold units are no longer
// in the live catalogue, so the snapshot is the only honest thing to draw them from. The snapshot is taken ONCE, when the
// lots are chosen; a live unit is always drawn from the live catalogue, so a price change still shows.
import { pickDoorbusters } from './bf-hero';

const norm = (s) => String(s || '').trim().toLowerCase();
const modelKey = (x) => `${norm(x.make)}|${norm(x.model)}`;

// Choose the lots: the same real, photographed, majors-first picks the hero used to show, frozen as snapshots.
export function chooseLots(units = [], n = 4) {
  return pickDoorbusters(units, n).map((g) => {
    const u = g.rep;
    return {
      sku: u.id, make: u.make || '', model: u.model || '', title: u.title || `${u.make || ''} ${u.model || ''}`.trim(),
      category: u.category || '', condition: u.condition || '', image: u.image || '',
      price: g.minPrice, compareAt: u.compareAt
    };
  });
}

const off = (price, was) => (was > price && price > 0 ? Math.round((1 - price / was) * 100) : 0);

// Turn lots + the live catalogue into slides, in lot order.
//  - the pinned SKU is still for sale  -> live slide on that unit
//  - the SKU is gone but another unit of the same make+model is for sale -> live slide on the cheapest of those
//    (a model we hold several of has not "sold out" when one goes)
//  - otherwise -> a SOLD slide drawn from the snapshot
export function lotsToSlides(lots = [], liveUnits = []) {
  const byId = new Map(liveUnits.map((u) => [u.id, u]));
  const used = new Set();
  return (lots || []).map((lot, i) => {
    let live = byId.get(lot.sku);
    if (!live) {
      live = liveUnits
        .filter((u) => !used.has(u.id) && modelKey(u) === modelKey(lot) && lot.model)
        .sort((a, b) => a.price - b.price)[0];
    }
    if (live) {
      used.add(live.id);
      const same = liveUnits.filter((u) => modelKey(u) === modelKey(live) && live.model);
      return {
        n: i + 1, sold: false, id: live.id, make: live.make || '', title: live.title || `${live.make} ${live.model}`.trim(),
        condition: live.condition || '', image: live.image || lot.image, price: live.price, was: live.compareAt || lot.compareAt,
        pct: off(live.price, live.compareAt), left: same.length
      };
    }
    return {
      n: i + 1, sold: true, id: lot.sku, make: lot.make, title: lot.title, condition: lot.condition, image: lot.image,
      price: lot.price, was: lot.compareAt, pct: off(lot.price, lot.compareAt), left: 0
    };
  });
}

// Slide to open on: the first one still for sale (a hero that opens on SOLD wastes the first impression).
export const firstLive = (slides = []) => Math.max(0, slides.findIndex((s) => !s.sold));

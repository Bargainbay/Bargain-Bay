// One card per model: identical make + model collapse into a single listing that
// shows the cheapest unit, "from" its price, and "N available" — the product
// page then lists every unit of that model to pick from (getSiblings).
//
// NO IMPORTS — the shop grid groups in the browser, the home page and clearance
// on the server, and all three must group the same way. The grouping used to be
// written inline in ShopClient only, so /shop showed one "4 available" card
// while the home page's New arrivals showed the same four Hisense fridges as four
// identical tiles (2026-09-17).
export const modelKey = (u) =>
  `${String(u?.make || '').trim()}|${String(u?.model || '').trim()}`.toLowerCase();

// Groups in order of first appearance. Each group: { rep, count, minPrice,
// maxPrice, units } with rep = the cheapest unit. A unit with no model number
// can't be told apart from a different appliance, so it is never grouped.
export function groupByModel(units = []) {
  const map = new Map();
  let loose = 0;
  for (const u of units) {
    const key = String(u?.model || '').trim() ? modelKey(u) : `__${loose++}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(u);
  }
  return [...map.values()].map((arr) => {
    const sorted = [...arr].sort((a, b) => a.price - b.price);
    return { rep: sorted[0], count: sorted.length, minPrice: sorted[0].price, maxPrice: sorted[sorted.length - 1].price, units: sorted };
  });
}

// The newest models, one card each: `units` is in catalogue order (newest
// last), so a model's position is where its most recent unit arrived.
export function newestModels(units = [], n = 12) {
  return groupByModel([...units].reverse()).slice(0, n);
}

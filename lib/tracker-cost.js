// Take a unit's cost from the MASTER TRACKER when the site has none.
//
// WHY: the site only imports Tested Working rows, so a unit sold while it is
// still Untested, in cleaning, or not yet synced has no `products.cost`. An
// invoice line with no cost of its own then has NO cost anywhere, and every
// profit report counts the sale as pure profit. The tracker has the cost (it is
// the source of truth); the invoice just never asked it.
//
// RULES
//   - A cost the rep TYPED always wins. This only fills a blank (NULL) line.
//   - If the site already knows the product's cost (> 0), the line is left NULL
//     on purpose: NULL means "use the product's cost", which works.
//   - A tracker cell that is EMPTY means unknown and fills nothing. A cell that
//     says 0 is a real zero (a haul-away) and is respected.
//   - DEGRADES OPEN. If the tracker cannot be read (no credentials, a Google
//     blip, staging) the line stays NULL and the invoice is saved anyway: losing
//     a sale to a failed lookup is worse than a blank cost, and the daily report
//     flags blanks.
import { query, hasDb } from './db';
import { readTrackerRows, sheetsConfigured } from './sheets';
import { round2 } from './constants';

const TTL_MS = 60_000;
let _cache = { at: 0, map: null };

export const parseCostCell = (cell) => {
  const s = String(cell ?? '').trim();
  if (!/\d/.test(s)) return null;                 // empty / text: unknown, not zero
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
};

/**
 * What a tracker row cost us, the way the rest of the system counts it: the
 * tracker's TOTAL COST (product + parts + labour), which is also what
 * products.cost holds after a sync. Cost of Product alone would leave out the
 * parts and labour that went into the unit and flatter its profit.
 *
 * Total Cost is a formula, and a row appended through the API can be born with
 * it empty (see MAIN_FORMULA_COLS in lib/sheets.js). When it is empty, fall back
 * to Cost of Product rather than treating the unit as having no cost.
 */
export const costFromRow = (r) => {
  const total = parseCostCell(r?.totalCost);
  return total != null ? total : parseCostCell(r?.cost);
};

/** Map of UPPERCASED sku -> cost, for every tracker row that states one. */
export async function trackerCosts({ maxAgeMs = TTL_MS } = {}) {
  if (_cache.map && Date.now() - _cache.at < maxAgeMs) return _cache.map;
  const rows = await readTrackerRows();
  const map = new Map();
  for (const r of rows) {
    const c = costFromRow(r);
    if (c != null) map.set(String(r.sku).trim().toUpperCase(), c);
  }
  _cache = { at: Date.now(), map };
  return map;
}

/**
 * Fill `cost` on blank unit lines, IN PLACE. Returns how many it filled.
 * `read` and `siteCosts` can be injected for tests.
 */
export async function fillCostsFromTracker(lines, { read = trackerCosts, siteCosts } = {}) {
  const need = (lines || []).filter((l) => l && l.sku && l.cost == null && (l.kind == null || l.kind === 'unit'));
  if (!need.length) return 0;
  try {
    // Skip anything the site can already cost: leaving it NULL is correct there.
    const skus = [...new Set(need.map((l) => String(l.sku).trim()))];
    let known = new Map();
    if (siteCosts) known = siteCosts;
    else if (hasDb()) {
      const { rows } = await query('SELECT sku, cost FROM products WHERE sku = ANY($1::text[])', [skus]);
      known = new Map(rows.map((r) => [String(r.sku).trim().toUpperCase(), Number(r.cost) || 0]));
    }
    const todo = need.filter((l) => !(known.get(String(l.sku).trim().toUpperCase()) > 0));
    if (!todo.length) return 0;
    if (!siteCosts && !sheetsConfigured()) return 0;
    const costs = await read();
    let filled = 0;
    for (const l of todo) {
      const c = costs.get(String(l.sku).trim().toUpperCase());
      if (c != null) { l.cost = c; filled += 1; }
    }
    return filled;
  } catch (e) {
    console.error('fillCostsFromTracker failed (left blank):', e?.message);
    return 0;
  }
}

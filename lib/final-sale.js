// Looks up what a unit's retail price is and stamps final sale on invoice lines. The rule itself is
// lib/return-rules.js. The site's product row is asked first; a unit it does not hold (sold while in
// cleaning, or not yet synced) is read from the tracker.
import { query, hasDb } from './db';
import { readTrackerRows, sheetsConfigured } from './sheets';
import { returnRulesApply, stampFinalSale } from './return-rules';

const key = (sku) => String(sku || '').trim().toUpperCase();
const money = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;

/** Map of UPPERCASED sku -> retail price. Anything that cannot be read is simply absent. */
export async function retailPrices(skus = [], { read = null } = {}) {
  const want = [...new Set(skus.map(key).filter(Boolean))];
  const out = new Map();
  if (!want.length) return out;
  // Each source on its own: one failing must not hide what the other knows.
  for (const sql of [
    'SELECT sku, compare_at FROM products WHERE upper(sku) = ANY($1::text[])',
    'SELECT sku, compare_at FROM vesta_products WHERE upper(sku) = ANY($1::text[])',
    'SELECT sku, compare_at FROM marketplace_listings WHERE upper(sku) = ANY($1::text[])'
  ]) {
    if (!hasDb()) break;
    try {
      const { rows } = await query(sql, [want]);
      for (const r of rows) if (Number(r.compare_at) > 0) out.set(key(r.sku), Number(r.compare_at));
    } catch (e) { console.error('retail price lookup failed', e?.message); }
  }
  const missing = want.filter((s) => !out.has(s));
  if (missing.length && (read || sheetsConfigured())) {
    try {
      for (const r of await (read || readTrackerRows)()) {
        const k = key(r.sku);
        if (missing.includes(k) && money(r.retail) > 0) out.set(k, money(r.retail));
      }
    } catch (e) { console.error('retail price tracker read failed', e?.message); }
  }
  return out;
}

/**
 * Stamp lines for a sale made at `at` (null = now). `known` carries retail prices already recorded
 * on the invoice, which win: an edit must not re-judge a unit against a newer retail figure.
 * Never throws — a failed lookup must not cost the sale.
 */
export async function markFinalSale(lines, { at = null, known = new Map() } = {}) {
  if (!returnRulesApply(at)) return lines;
  try {
    const need = lines.filter((l) => (!l.kind || l.kind === 'unit') && l.sku && !known.has(key(l.sku))).map((l) => l.sku);
    const found = await retailPrices(need);
    for (const [k, v] of known) found.set(k, v);
    stampFinalSale(lines, found);
  } catch (e) {
    console.error('markFinalSale failed', e?.message);
  }
  return lines;
}

// The model number behind an invoice line, looked up from its stock SKU.
//
// Looked up when the invoice is shown, not stored on it: products first, then the
// master tracker for a unit the site has never imported (sold while it was still
// being cleaned or repaired). So old invoices get it too, and a model corrected
// on the tracker is corrected on the invoice.
//
// DEGRADES OPEN. A failed lookup leaves the line as it was; an invoice must
// always render and send.
import { hasDb, query } from './db';
import { readTrackerRows, sheetsConfigured } from './sheets';
import { isUnitLine } from './constants';

const TTL_MS = 5 * 60_000;
let _cache = { at: 0, rows: null };

async function trackerRows() {
  if (_cache.rows && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  const rows = await readTrackerRows();
  _cache = { at: Date.now(), rows };
  return rows;
}

const key = (sku) => String(sku || '').trim().toUpperCase();

/**
 * What we know about each SKU: Map of UPPERCASED sku ->
 * { sku, make, model, category, serial }, sku as it is spelled where it was found.
 * `read` can be injected for tests.
 */
export async function unitsForSkus(skus = [], { read } = {}) {
  const want = [...new Set((skus || []).map(key).filter(Boolean))];
  const out = new Map();
  if (!want.length) return out;
  if (hasDb()) {
    try {
      const { rows } = await query(
        'SELECT sku, make, model, category, uid AS serial FROM products WHERE upper(sku) = ANY($1::text[])', [want]);
      for (const r of rows) out.set(key(r.sku), r);
    } catch (e) { console.error('unit lookup (products) failed', e?.message); }
  }
  const missing = want.filter((s) => !out.get(s)?.model);
  if (missing.length && (read || sheetsConfigured())) {
    try {
      const need = new Set(missing);
      for (const r of await (read || trackerRows)()) {
        const k = key(r.sku);
        if (!need.has(k)) continue;
        const had = out.get(k);
        // The first row wins, as everywhere else that reads the tracker.
        need.delete(k);
        out.set(k, {
          sku: had?.sku || r.sku, make: had?.make || r.make, model: had?.model || r.model,
          category: had?.category || r.category, serial: had?.serial || r.serial
        });
      }
    } catch (e) { console.error('unit lookup (tracker) failed', e?.message); }
  }
  return out;
}

/** The same lines with `model` filled on every appliance line whose unit has one. */
export async function withModels(lines = [], opts = {}) {
  const unit = (l) => l && l.sku && (l.kind == null || isUnitLine(l.kind));
  const need = (lines || []).filter((l) => unit(l) && !l.model);
  if (!need.length) return lines;
  try {
    const found = await unitsForSkus(need.map((l) => l.sku), opts);
    return lines.map((l) => {
      const model = unit(l) && !l.model ? found.get(key(l.sku))?.model : null;
      return model ? { ...l, model } : l;
    });
  } catch (e) {
    console.error('withModels failed (left blank):', e?.message);
    return lines;
  }
}

// The tracker's Suggested Sale Price formula, made vendor-aware. NO imports: the
// route, the sheet writer and the tests all share it.
//
// A vendor's drop-offs are priced above Retail x Condition % (see
// CONSIGNMENT_VENDOR_UPLIFT_PCT). The website applies that when it reads the row
// (lib/csv.js); this puts the SAME rule into the sheet's own formula, so the
// number a person reads off the tracker is the number the site charges.
//
// It WRAPS whatever formula the cell already has instead of replacing it, and
// the wrapper is exact enough to be undone: unwrapPriceFormula() recovers the
// original character for character. That is the rollback.

const WRAP = /^=IF\(LOWER\(TRIM\(([A-Z]+[0-9]+)\)\)="([a-z0-9]+)",ROUND\(\(([\s\S]*)\)\*([0-9.]+),2\),([\s\S]*)\)$/;

// `vendorCell` is the cell on THIS row that names the vendor, e.g. "H854".
export function wrapPriceFormula(formula, { vendorCell, vendorKey = 'abi', factor }) {
  const f = String(formula || '').trim();
  if (!f.startsWith('=')) return null;               // a typed value is a deliberate override: leave it
  if (isWrapped(f)) return f;                        // already done: idempotent
  const orig = f.slice(1);
  return `=IF(LOWER(TRIM(${vendorCell}))="${vendorKey}",ROUND((${orig})*${factor},2),${orig})`;
}

export function isWrapped(formula) {
  const m = WRAP.exec(String(formula || '').trim());
  return !!m && m[5] === m[3];                       // the two branches share the original
}

// The original formula, exactly as it was before wrapPriceFormula, or null.
export function unwrapPriceFormula(formula) {
  const f = String(formula || '').trim();
  const m = WRAP.exec(f);
  if (!m || m[5] !== m[3]) return null;
  return `=${m[3]}`;
}

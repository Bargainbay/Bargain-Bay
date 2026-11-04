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

// ── The retail-percentage rule, in the sheet (owner, 2026-11-04) ────────────
// Abi is listed at a share of RETAIL by condition (VENDOR_LIST_RULES in
// lib/constants.js: New in Box 90, New Open Box / Scratch & Dent 85, Refurbished
// 60). For his rows the Suggested Sale Price becomes retail x that share; for
// every other vendor, and for any Abi row with no retail or an unnamed
// condition, the cell's original formula stands. It WRAPS the original, and the
// original is recoverable character for character (unwrapListFormula) — that is
// the rollback. A cell still wrapped with the old x1.2 uplift is unwrapped first.
//
// `rates` = { nib, nob, refurb } as whole percentages.
function listPrefix({ vendorCell, retailCell, condCell, vendorKey = 'abi', rates }) {
  const c = `LOWER(TRIM(${condCell}))`;
  const rate = `IF(OR(${c}="new open box",ISNUMBER(SEARCH("scratch",${condCell}))),${rates.nob},IF(${c}="new in box",${rates.nib},IF(OR(${c}="refurbished",${c}="used"),${rates.refurb},0)))`;
  return `=IF(LOWER(TRIM(${vendorCell}))="${vendorKey}",IF(AND(N(${retailCell})>0,${rate}>0),ROUND(${retailCell}*${rate}/100,2),(`;
}

export function wrapListFormula(formula, opts) {
  const f = String(formula || '').trim();
  if (!f.startsWith('=')) return null;               // a typed value is a deliberate override
  if (unwrapListFormula(f, opts) != null) return f;  // already done: idempotent
  const legacy = unwrapPriceFormula(f);              // the old x1.2 wrapper comes off first
  const orig = (legacy != null ? legacy : f).slice(1);
  return `${listPrefix(opts)}${orig})),(${orig}))`;
}

export function unwrapListFormula(formula, opts) {
  const f = String(formula || '').trim();
  const prefix = listPrefix(opts);
  if (!f.startsWith(prefix) || !f.endsWith('))')) return null;
  const mid = f.slice(prefix.length, -2);
  if ((mid.length - 4) % 2 !== 0) return null;
  const len = (mid.length - 4) / 2;
  const orig = mid.slice(0, len);
  return mid === `${orig})),(${orig}` ? `=${orig}` : null;
}

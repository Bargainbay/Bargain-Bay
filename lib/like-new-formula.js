// The tracker's Suggested Sale Price formula, made Like-New-aware. NO imports:
// the sheet writer and the tests share it.
//
// The website prices a Like New unit at a flat share of retail (lib/csv.js,
// LIKE_NEW_PCT). The sheet's own formula puts a cost-plus floor on anything
// under $1,000, which would show a different figure there. This wrapper makes a
// Like New row read Retail x Condition % (the Settings tab's Like New tier) on
// both sides of $1,000, and leaves every other row's formula exactly as it was.
//
// It is ALWAYS THE OUTERMOST LAYER. The grade and vendor actions peel it off,
// work on the formula underneath, and put it back (lib/sheets.js), so none of
// them can wrap a cell twice because this one is around it.

function head({ condCell, retailCell, pctCell }) {
  return `=IF(AND(LOWER(TRIM(${condCell}))="like new",N(${retailCell})>0,N(${pctCell})>0),ROUND(${retailCell}*${pctCell},2),(`;
}

export function wrapLikeNewFormula(formula, opts) {
  const f = String(formula || '').trim();
  if (!f.startsWith('=')) return null;                   // a typed value is a deliberate override
  if (unwrapLikeNewFormula(f, opts) != null) return f;   // already done: idempotent
  return `${head(opts)}${f.slice(1)}))`;
}

export function unwrapLikeNewFormula(formula, opts) {
  const f = String(formula || '').trim();
  const h = head(opts);
  if (!f.startsWith(h) || !f.endsWith('))')) return null;
  return `=${f.slice(h.length, -2)}`;
}

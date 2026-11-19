// The tracker's Suggested Sale Price formula, made grade-aware. NO imports: the
// sheet writer and the tests share it.
//
// The website applies the GA/GB New Scratch & Dent bump itself (lib/grade-pricing.js);
// this puts the SAME rule in the sheet so the figure a person reads off the tracker
// is the figure the site charges. The grade lives on a "Grades" tab (SKU | Grade)
// that Bargain Bay fills from RS Ops, because the Main tab has no grade column.
//
// Like the vendor rule it WRAPS the cell's existing formula and the wrapper is
// exact enough to undo: unwrapGradeFormula() returns the original character for
// character. That is the rollback.

export const GRADES_TAB = 'Grades';

// The tracker's own under-$1,000 rule (Settings!E13 retail threshold, E15 ask cap, as the live
// Suggested Sale Price formulas reference them): below the threshold a price never goes above
// retail x ask cap. The bump must not push a unit past it.
const THRESHOLD = 'Settings!$E$13';
const ASK_CAP = 'Settings!$E$15';

function prefix({ condCell, retailCell, skuCell, points = 5, grades = ['GA', 'GB'] }) {
  const g = `IFERROR(VLOOKUP(TRIM(${skuCell}),${GRADES_TAB}!$A:$B,2,FALSE),"")`;
  const isGrade = grades.map((x) => `${g}="${x}"`).join(',');
  return {
    head: `=IF(AND(ISNUMBER(SEARCH("scratch",${condCell})),OR(${isGrade}),N(${retailCell})>0),MIN(${retailCell},IF(${retailCell}<${THRESHOLD},${retailCell}*${ASK_CAP},${retailCell}),ROUND((`,
    tail: `)+${retailCell}*${points}/100,2)),(`
  };
}

export function wrapGradeFormula(formula, opts) {
  const f = String(formula || '').trim();
  if (!f.startsWith('=')) return null;               // a typed value is a deliberate override
  if (unwrapGradeFormula(f, opts) != null) return f; // already done: idempotent
  const orig = f.slice(1);
  const { head, tail } = prefix(opts);
  return `${head}${orig}${tail}${orig}))`;
}

export function unwrapGradeFormula(formula, opts) {
  const f = String(formula || '').trim();
  const { head, tail } = prefix(opts);
  if (!f.startsWith(head) || !f.endsWith('))')) return null;
  const mid = f.slice(head.length, -2);
  if ((mid.length - tail.length) % 2 !== 0) return null;
  const len = (mid.length - tail.length) / 2;
  const orig = mid.slice(0, len);
  return mid === `${orig}${tail}${orig}` ? `=${orig}` : null;
}

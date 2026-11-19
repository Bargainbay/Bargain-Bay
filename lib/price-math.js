// The four ways a person changes a price in bulk. NO imports: the route and the tests share it.
//   pct     raise/lower by a percentage            (amount 5 = +5%, -10 = -10%)
//   usd     raise/lower by dollars                 (amount 50 = +$50, -25 = -$25)
//   markup  set to cost plus a percentage          (amount 30 = cost x 1.30)
//   retail  set to a percentage of the retail price (amount 70 = 70% of retail)
export const BULK_MODES = ['pct', 'usd', 'markup', 'retail'];
export function newPriceFor(base, { cost, retail }, mode, amount, round) {
  let p = null;
  if (mode === 'pct') p = base * (1 + amount / 100);
  else if (mode === 'usd') p = base + amount;
  else if (mode === 'markup') p = cost > 0 ? cost * (1 + amount / 100) : null;
  else if (mode === 'retail') p = retail > 0 ? retail * amount / 100 : null;
  if (p == null || !Number.isFinite(p)) return null;
  p = round === 'dollar' ? Math.round(p) : Math.round(p * 100) / 100;
  return p > 0 ? p : null;
}

// What a price box means. Plain number = that price. "+5%" / "-10%" = relative to the price the row
// shows now. "+50" / "-25" (a sign) = dollars up or down. Returns null for anything else.
export function resolveTyped(text, base) {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (t === '') return null;
  const rel = /^([+-])(\d+(?:\.\d+)?)(%?)$/.exec(t);
  if (rel) {
    const n = Number(rel[2]) * (rel[1] === '-' ? -1 : 1);
    const v = rel[3] ? base * (1 + n / 100) : base + n;
    return v > 0 ? Math.round(v * 100) / 100 : null;
  }
  if (/^\d+(\.\d+)?$/.test(t)) { const v = Number(t); return v > 0 ? Math.round(v * 100) / 100 : null; }
  if (/^\d+(\.\d+)?%$/.test(t)) return null; // "5%" with no sign is ambiguous: say +5% or -5%
  return null;
}

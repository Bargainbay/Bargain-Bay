// What the Black Friday hero shows, worked out from the LIVE catalogue so it can never go stale.
// Pure (imports only the grouping helpers, which import nothing), so it is tested without a database.
//
// THE RULE: every figure on the hero is a fact about a unit we hold right now. "Up to 77% off retail" is the
// deepest real markdown in stock; each card is a real unit at its real price against its real retail. Nothing here
// is typed in by hand, so when a unit sells the hero stops showing it. (Replaces a one-unit hero whose "1/1 left"
// badge sat on a dishwasher that was not actually a doorbuster.)
import { groupByModel, isVestaUnit } from './group-units';

const off = (u) => (u && u.compareAt > u.price && u.price > 0 ? Math.round((1 - u.price / u.compareAt) * 100) : 0);
// Our own stock only: a seller's or Vesta's unit is not ours to headline, and has no tested-by-us warranty promise.
const ours = (u) => !u?.vendor && !isVestaUnit(u);
const realPhoto = (u) => !!u?.image && !String(u.image).endsWith('.svg');

// The deepest real markdown across everything we sell: the "up to X% off" claim.
export function topOffPct(units = []) {
  return units.filter(ours).reduce((m, u) => Math.max(m, off(u)), 0);
}

// The cards: biggest markdowns first, ONE PER MODEL (a model with several units says "N available" instead of
// repeating), only units with real photography (a placeholder drawing is not a hero), only real retail prices
// worth a headline, and a spread of appliance types before any type repeats so the row does not read as four
// identical washers.
export function pickDoorbusters(units = [], n = 4, { minRetail = 500, minOff = 30 } = {}) {
  const pool = units.filter((u) => ours(u) && realPhoto(u) && u.compareAt >= minRetail && off(u) >= minOff);
  const groups = groupByModel(pool)
    .map((g) => ({ ...g, pct: off(g.rep), saves: Math.round(g.rep.compareAt - g.rep.price) }))
    .sort((a, b) => b.pct - a.pct || b.saves - a.saves);
  const picked = [];
  const seen = new Set();
  for (const g of groups) {                       // first pass: one per appliance type
    const type = String(g.rep.category || '').toLowerCase();
    if (seen.has(type)) continue;
    seen.add(type); picked.push(g);
    if (picked.length === n) return picked;
  }
  for (const g of groups) {                       // then fill from the rest
    if (picked.includes(g)) continue;
    picked.push(g);
    if (picked.length === n) break;
  }
  return picked;
}

// The instant a Toronto calendar day ENDS (23:59:59 local), as epoch ms, for the countdown. DST-safe: the zone's own
// offset on that day is read from Intl rather than assuming -05:00.
export function endOfTorontoDayMs(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(guess));
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const asLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guess - (asLocal - guess);   // guess is UTC wall-clock; subtract the zone's offset from it
}

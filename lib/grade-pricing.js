// New Scratch & Dent units graded GA or GB (RS Ops's cosmetic grade) list 5 points
// of retail higher than GC / GD (owner, 2026-11-19): 60% -> 65%, and 70% -> 75%
// on the Under-$1,000 tier. A unit with no grade, or any other condition, is
// untouched.
//
// WHERE THE GRADE COMES FROM: RS Ops (the tracker has no grade column), through
// the key-protected /api/intake/grades feed. It is NOT the public storefront
// feed — that lists only units with approved photos, which would price every
// other unit as if it had no grade.
//
// One place, like the vendor rule: it runs in the sync, where a tracker row has
// become a unit and before typed list-price overrides (which still win).
import { getSetting, setSetting } from './settings';

export const GRADE_BUMP = Object.freeze({
  condition: 'New Scratch & Dent',
  grades: ['GA', 'GB'],
  points: 5               // percentage points of RETAIL, on either tier
});

const KEY = 'unit_grades_last_good';
const BASE = () => (process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca').replace(/\/+$/, '');
const money2 = (n) => Math.round(Number(n) * 100) / 100;
const norm = (s) => String(s || '').trim().toUpperCase();

export const bumpApplies = (condition, grade) =>
  condition === GRADE_BUMP.condition && GRADE_BUMP.grades.includes(norm(grade));

// The list price a unit gets. PURE. Needs a retail to take a share of; with
// none the price stands, never guessed.
export function bumpedPrice(unit, grade) {
  const retail = Number(unit?.compareAt) || 0;
  const price = Number(unit?.price) || 0;
  if (!bumpApplies(unit?.condition, grade) || !(retail > 0) || !(price > 0)) return price;
  return Math.min(retail, money2(price + retail * GRADE_BUMP.points / 100));
}

// PURE. `grades` is { SKU: 'GA' }. Returns the units and how many moved.
export function applyGradePricing(units, grades) {
  const g = new Map(Object.entries(grades || {}).map(([k, v]) => [norm(k), norm(v)]));
  let bumped = 0;
  const out = (units || []).map((u) => {
    const grade = g.get(norm(u.id));
    if (!grade) return u;
    const price = bumpedPrice(u, grade);
    if (price === Number(u.price)) return u;
    bumped++;
    return { ...u, price };
  });
  return { units: out, bumped };
}

async function pull() {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) throw new Error('RSOPS_INTAKE_KEY not set');
  const res = await fetch(`${BASE()}/api/intake/grades`, {
    headers: { 'x-rsops-key': key }, cache: 'no-store', signal: AbortSignal.timeout(15000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.grades || typeof body.grades !== 'object') throw new Error(body.error || `RS Ops answered ${res.status}`);
  return body.grades;
}

// Fetches the grades, remembering the last good answer. If RS Ops cannot be
// reached the LAST GOOD map is used: dropping to "no grades" would quietly
// reprice every GA/GB unit down 5 points on the next sync. Returns
// { grades, stale, error }. With nothing remembered either, grades is {} and the
// error is reported so the sync message can say so.
export async function loadGrades() {
  try {
    const grades = await pull();
    try { await setSetting(KEY, grades); } catch {}
    return { grades, stale: false, error: null };
  } catch (e) {
    let last = null;
    try { last = await getSetting(KEY, null); } catch {}
    return { grades: last && typeof last === 'object' ? last : {}, stale: true, error: String(e?.message || e) };
  }
}

export async function applyGradePricingLive(units, { refreshSheet } = {}) {
  const { grades, stale, error } = await loadGrades();
  // Keep the sheet's Grades tab current so the tracker's own price formula agrees. Best-effort and only
  // when the tab already exists (the admin action creates it): a sheet hiccup must never fail a sync.
  if (refreshSheet && !stale) { try { await refreshSheet(grades); } catch {} }
  const r = applyGradePricing(units, grades);
  return { units: r.units, gradePricing: { bumped: r.bumped, stale, error } };
}

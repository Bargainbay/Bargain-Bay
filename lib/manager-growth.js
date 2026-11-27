// The Manager's GROWTH eyes for Bargain Bay: who to call next, what people asked for that
// we did not have, which listings are weak, and where pricing needs a look.
//
// Until now the Manager's autonomous work was housekeeping (follow-ups, stock refresh, payment
// matching, photos). Nothing in it looked at how sales are going. This module is that view.
//
// RULES THAT MUST HOLD
//   · READ-ONLY. Nothing here writes, emails, texts, prices or lists anything. It RANKS and
//     REPORTS; a person (or the existing, gated tools) acts. A test greps this file for writes.
//   · Every reader degrades to "nothing" on a database error and never throws into the scan,
//     the call or the page. A check that fails is reported by the scanner, not hidden.
//   · No cost or margin figure is ever put in a field a sales login could read: the brief is
//     ADMIN only (page + route), and the sales queue itself carries no cost.
//   · Nothing here contacts a customer. The queue is a to-do list for staff.
//   · The pure functions (scoring, grouping, problem tests) take plain rows so they are tested
//     without a database.
import { hasDb, query } from './db';
import { OPEN_STAGES, WANTED_CATEGORIES } from './lead-rules';
import { abandonedCarts } from './abandoned-carts';
import { ensureLeadLogSchema } from './lead-log';

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
const money0 = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-CA')}`;

// ── 1. The sales queue: who is worth ringing next ────────────────────────────

const WARM_SOURCES = new Set(['phone', 'website', 'chat', 'social', 'walk_in', 'google_ads', 'partner', 'referral']);

/**
 * A lead's urgency, 0-100, and the plain reason. PURE.
 * Heat first, then money, then how long it has sat untouched: an unanswered lead is the one a
 * competitor gets.
 */
export function scoreLead(l, { now = Date.now() } = {}) {
  let score = 0; const why = [];
  const temp = l.temperature === 'hot' ? 30 : l.temperature === 'warm' ? 15 : 0;
  if (temp) { score += temp; why.push(`${l.temperature} lead`); }
  const value = Number(l.est_value) || 0;
  if (value > 0) { score += Math.min(25, Math.round(value / 200)); why.push(`worth about ${money0(value)}`); }
  const ageH = Number.isFinite(Number(l.age_hours)) ? Number(l.age_hours) : Math.max(0, (now - new Date(l.created_at).getTime()) / 3600_000);
  const untouched = !l.first_touch_at;
  if (untouched) {
    score += 15; why.push('nobody has contacted them');
    if (ageH >= 24) { score += 10; why.push(`waiting ${Math.floor(ageH / 24)} day${ageH >= 48 ? 's' : ''}`); }
    else if (ageH >= 4) why.push(`waiting ${Math.floor(ageH)}h`);
  }
  if (l.overdue) { score += 10; why.push('a promised next step is overdue'); }
  if (WARM_SOURCES.has(l.source)) score += 5;
  if (!l.owner_email) { score += 5; why.push('no owner yet'); }
  if (ageH > 14 * 24) { score -= 20; why.push('over two weeks old'); }
  return { score: Math.max(0, Math.min(100, score)), why: why.join('; ') };
}

/**
 * An abandoned cart's urgency. PURE. A cart is warmest between 4 and 48 hours after it went quiet,
 * and is only worth anything while a unit in it is still for sale.
 */
export function scoreCart(c) {
  if (!c.availableCount) return { score: 0, why: 'nothing in it is still for sale' };
  let score = 20; const why = [`${plural(c.availableCount, 'unit')} still for sale, ${money0(c.availableTotal)}`];
  score += Math.min(30, Math.round((c.availableTotal || 0) / 150));
  const h = Number(c.ageHours) || 0;
  if (h <= 48) { score += 20; why.push('left in the last two days'); }
  else if (h <= 168) { score += 8; why.push('left this week'); }
  if (c.taskedAt) { score -= 10; why.push('a follow-up was already raised'); }
  return { score: Math.max(0, Math.min(100, score)), why: why.join('; ') };
}

/** Merge scored leads and carts into one ranked list, highest first. PURE. */
export function buildSalesQueue({ leads = [], carts = [], limit = 12, now = Date.now() } = {}) {
  const items = [];
  for (const l of leads) {
    const { score, why } = scoreLead(l, { now });
    items.push({
      kind: 'lead', id: l.id, who: l.company || l.contact_name || 'Unnamed lead',
      what: l.wanted || (l.wanted_category ? (WANTED_CATEGORIES.find(([k]) => k === l.wanted_category) || [0, l.wanted_category])[1] : null),
      value: Number(l.est_value) || null, owner: l.owner_email || null, source: l.source || null,
      score, why, link: `/sales/leads`
    });
  }
  for (const c of carts) {
    const { score, why } = scoreCart(c);
    if (!c.availableCount) continue;
    items.push({
      kind: 'cart', id: c.id, who: c.name || c.email || c.phone || 'Unknown shopper',
      what: c.units.filter((u) => u.state === 'available').map((u) => u.title).slice(0, 3).join('; '),
      value: c.availableTotal, owner: null, source: 'abandoned cart', score, why, link: '/admin/dashboard'
    });
  }
  items.sort((a, b) => b.score - a.score || (b.value || 0) - (a.value || 0));
  return items.slice(0, Math.max(1, limit));
}

const OPEN_LEAD_SQL = `
  SELECT l.id, l.company, l.contact_name, l.source, l.stage, l.temperature, l.est_value::float AS est_value,
         l.owner_email, l.first_touch_at, l.last_activity_at, l.next_step, l.created_at, l.wanted, l.wanted_category,
         extract(epoch FROM (now() - l.created_at)) / 3600.0 AS age_hours,
         COALESCE(l.next_step_at < (now() AT TIME ZONE 'America/Toronto')::date, false) AS overdue
    FROM leads l
   WHERE l.side <> 'rs' AND COALESCE(l.source, '') <> 'imported'
     AND l.stage = ANY($1) AND l.customer_id IS NULL
     AND l.created_at >= now() - interval '45 days'
     AND NOT EXISTS (
       SELECT 1 FROM orders o
        WHERE o.status <> 'cancelled' AND o.created_at >= l.created_at
          AND ((l.email IS NOT NULL AND lower(o.email) = lower(l.email))
            OR (l.phone_key IS NOT NULL AND o.phone IS NOT NULL
                AND right(regexp_replace(o.phone, '\\D', '', 'g'), 10) = right(l.phone_key, 10))))
   ORDER BY l.created_at DESC LIMIT 300`;

export async function openLeadRows() {
  if (!hasDb()) return [];
  await ensureLeadLogSchema();
  try { return (await query(OPEN_LEAD_SQL, [OPEN_STAGES])).rows; } catch { return []; }
}

/** The ranked queue of people worth ringing: Bargain Bay's open leads plus carts left behind. */
export async function salesQueue({ limit = 12 } = {}) {
  const [leads, carts] = await Promise.all([openLeadRows(), abandonedCarts({ hours: 4, limit: 100 }).catch(() => [])]);
  const all = buildSalesQueue({ leads, carts, limit: 1000 });
  const waiting = leads.filter((l) => !l.first_touch_at && Number(l.age_hours) >= 24);
  return {
    items: all.slice(0, limit),
    counts: { leads: leads.length, carts: carts.filter((c) => c.availableCount).length, untouchedOver24h: waiting.length },
    waiting: waiting.length
  };
}

// ── 2. What people asked for and we did not have ─────────────────────────────

// Which product rows answer which wanted category. Word-start matches on category + title.
const WANT_PATTERNS = {
  refrigerator: /\b(refrigerator|fridge)/i, range: /\b(range|stove)/i, cooktop: /\bcooktop/i,
  wall_oven: /\bwall\s*oven|\boven\b/i, dishwasher: /\bdishwasher/i, washer: /\bwasher/i,
  dryer: /\bdryer/i, laundry_set: /\b(laundry|washer.*dryer|pair)/i, microwave: /\b(microwave|hood)/i, freezer: /\bfreezer/i
};
export const matchesWanted = (key, text) => (WANT_PATTERNS[key] ? WANT_PATTERNS[key].test(String(text || '')) : false);

/**
 * Group "no stock" losses by what was wanted and set each against what we hold NOW. PURE.
 * rows: { wanted, wanted_category }, units: { category, title }.
 */
export function summarizeDemand(rows = [], units = []) {
  const by = new Map();
  for (const r of rows) {
    const key = r.wanted_category || 'unrecorded';
    const row = by.get(key) || { key, asked: 0, examples: [] };
    row.asked += 1;
    if (r.wanted && row.examples.length < 4) row.examples.push(String(r.wanted).slice(0, 80));
    by.set(key, row);
  }
  const out = [...by.values()].map((r) => {
    const label = r.key === 'unrecorded' ? 'Not recorded' : (WANTED_CATEGORIES.find(([k]) => k === r.key) || [0, r.key])[1];
    const inStockNow = r.key === 'unrecorded' || r.key === 'other' ? null
      : units.filter((u) => matchesWanted(r.key, `${u.category || ''} ${u.title || ''}`)).length;
    return { ...r, label, inStockNow };
  });
  out.sort((a, b) => b.asked - a.asked);
  return out;
}

export async function lostDemand({ days = 30 } = {}) {
  if (!hasDb()) return { days, total: 0, byCategory: [] };
  await ensureLeadLogSchema();
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  try {
    const { rows } = await query(
      `SELECT l.wanted, l.wanted_category FROM leads l
        WHERE l.side <> 'rs' AND COALESCE(l.source, '') <> 'imported' AND l.lost_reason = 'no_stock'
          AND l.created_at >= now() - ($1 || ' days')::interval
          AND l.customer_id IS NULL`, [String(d)]);
    const { rows: units } = await query(`SELECT category, title FROM products WHERE active = true AND sold_at IS NULL`);
    return { days: d, total: rows.length, byCategory: summarizeDemand(rows, units) };
  } catch { return { days: d, total: 0, byCategory: [] }; }
}

// ── 3. Listing quality ───────────────────────────────────────────────────────

export const LISTING_PROBLEMS = {
  no_price: 'No price',
  above_retail: 'Priced above retail',
  no_model: 'No model number',
  vague_category: 'Vague or missing category',
  thin_title: 'Title is too short to sell',
  no_condition: 'No condition',
  no_cost: 'No cost recorded'
};

/** The problems with ONE live unit row. PURE. */
export function listingProblems(p) {
  const out = [];
  const price = Number(p.price);
  if (!(price > 0)) out.push('no_price');
  if (price > 0 && Number(p.compare_at) > 0 && price > Number(p.compare_at)) out.push('above_retail');
  if (!String(p.model || '').trim()) out.push('no_model');
  const cat = String(p.category || '').trim().toLowerCase();
  if (!cat || cat === 'appliance' || cat === 'other') out.push('vague_category');
  if (String(p.title || '').trim().length < 12) out.push('thin_title');
  if (!String(p.condition || '').trim()) out.push('no_condition');
  if (!(Number(p.cost) > 0)) out.push('no_cost');
  return out;
}

/**
 * Summarise problems across live units. PURE. The point is a short list somebody can fix at the
 * source (the tracker row), not a number to feel bad about.
 */
export function summarizeListings(units = []) {
  const by = {};
  for (const k of Object.keys(LISTING_PROBLEMS)) by[k] = [];
  let flagged = 0;
  for (const u of units) {
    const probs = listingProblems(u);
    if (probs.length) flagged += 1;
    for (const k of probs) by[k].push(u.sku);
  }
  return {
    checked: units.length, flagged,
    byProblem: Object.entries(by).filter(([, skus]) => skus.length)
      .map(([key, skus]) => ({ key, label: LISTING_PROBLEMS[key], count: skus.length, examples: skus.slice(0, 6) }))
      .sort((a, b) => b.count - a.count)
  };
}

export async function listingQuality() {
  if (!hasDb()) return { checked: 0, flagged: 0, byProblem: [], noStockPhoto: [] };
  try {
    const { rows } = await query(
      `SELECT sku, make, model, category, title, condition, price::float AS price, compare_at::float AS compare_at,
              cost::float AS cost, image_url
         FROM products WHERE active = true AND sold_at IS NULL`);
    const summary = summarizeListings(rows);
    let noStockPhoto = [];
    try {
      const { warmModelPhotos } = await import('./model-photos');
      const { modelsWithoutStockPhoto } = await import('./images');
      await warmModelPhotos();
      noStockPhoto = modelsWithoutStockPhoto(rows.map((r) => ({ id: r.sku, make: r.make, model: r.model, title: r.title, category: r.category, image: r.image_url })))
        .slice(0, 10).map((m) => ({ model: m.model, units: m.skus.length }));
    } catch { /* photo check is optional */ }
    return { ...summary, noStockPhoto };
  } catch { return { checked: 0, flagged: 0, byProblem: [], noStockPhoto: [] }; }
}

// ── 4. Pricing watch (advice only) ───────────────────────────────────────────

/** Units sitting 90+ days with a healthy margin, and a suggested opening drop. Moved here from manager-business. */
export async function staleStockHits() {
  if (!hasDb()) return [];
  const { sheetsConfigured, readTrackerRows } = await import('./sheets');
  if (!sheetsConfigured()) return [];
  const { stalePricing, ageDays } = await import('./manager-policy');
  const tracker = await readTrackerRows();
  const { rows: prods } = await query('SELECT sku, price::float AS price, cost::float AS cost FROM products WHERE active = true');
  const by = Object.fromEntries(prods.map((p) => [p.sku, p]));
  const hits = [];
  for (const t of tracker) {
    const p = by[t.sku]; if (!p) continue;
    const s = stalePricing({ price: p.price, cost: p.cost, ageDays: ageDays(t.dateReceived) });
    if (s) hits.push({ sku: t.sku, ...s });
  }
  hits.sort((a, b) => b.margin - a.margin);
  return hits;
}

/** Units priced at or under cost + 10%, or above their own retail. PURE. */
export function pricingFlags(units = []) {
  const thin = []; const aboveRetail = [];
  for (const u of units) {
    const price = Number(u.price); const cost = Number(u.cost); const retail = Number(u.compare_at);
    if (price > 0 && cost > 0 && price < cost * 1.1) thin.push({ sku: u.sku, title: u.title, price, cost, marginPct: Math.round(((price - cost) / price) * 100) });
    if (price > 0 && retail > 0 && price > retail) aboveRetail.push({ sku: u.sku, title: u.title, price, retail });
  }
  return { thin, aboveRetail };
}

export async function pricingWatch() {
  const out = { stale: [], thin: [], aboveRetail: [], trackerRead: true };
  if (!hasDb()) return out;
  try { out.stale = (await staleStockHits()).slice(0, 8); } catch { out.trackerRead = false; }
  try {
    const { rows } = await query(
      `SELECT sku, title, price::float AS price, cost::float AS cost, compare_at::float AS compare_at
         FROM products WHERE active = true AND sold_at IS NULL`);
    const f = pricingFlags(rows);
    out.thin = f.thin.slice(0, 10); out.aboveRetail = f.aboveRetail.slice(0, 10);
  } catch { /* leave empty */ }
  return out;
}

// ── The Manager's scan: one issue per growth problem ─────────────────────────

async function checkSalesQueue() {
  if (!hasDb()) return [];
  const q = await salesQueue({ limit: 5 });
  const hot = q.items.filter((i) => i.score >= 50);
  if (!q.waiting && !hot.length) return [];
  const top = q.items[0];
  return [{
    key: 'biz-sales-queue', area: 'sales', severity: q.waiting >= 5 ? 'high' : 'medium',
    title: `${plural(q.waiting, 'lead')} waiting over a day untouched, ${plural(q.counts.carts, 'cart')} left behind`,
    speak: `${plural(q.waiting, 'lead')} ${q.waiting === 1 ? 'has' : 'have'} waited over a day with nobody calling. ${top ? `The best one to ring first is ${top.who}: ${top.why}` : ''}`,
    detail: q.items.map((i) => `${i.kind === 'lead' ? 'Lead' : 'Cart'}: ${i.who}${i.what ? ` (${i.what})` : ''} — ${i.why} [score ${i.score}]`).join('\n'),
    count: q.waiting + q.counts.carts, link: '/admin/manager/brief'
  }];
}

async function checkLostDemand() {
  const d = await lostDemand({ days: 30 });
  if (d.total < 3) return [];
  const top = d.byCategory.find((c) => c.key !== 'unrecorded') || d.byCategory[0];
  return [{
    key: 'biz-lost-demand', area: 'sales', severity: d.total >= 8 ? 'high' : 'medium',
    title: `${plural(d.total, 'buyer')} in 30 days wanted something we did not have`,
    speak: `${plural(d.total, 'buyer')} in the last thirty days wanted something we did not have in stock. The most asked for is ${top.label.toLowerCase()}, ${top.asked} times${top.inStockNow === 0 ? ' and we hold none' : ''}`,
    detail: d.byCategory.map((c) => `${c.label}: asked ${c.asked}×${c.inStockNow == null ? '' : `, ${c.inStockNow} in stock now`}${c.examples.length ? ` — e.g. ${c.examples.join(' | ')}` : ''}`).join('\n'),
    count: d.total, link: '/admin/lead-log'
  }];
}

async function checkListingQuality() {
  const q = await listingQuality();
  // "No cost" is real but it is the tracker's job (cost-fix); only surface problems that stop or weaken a SALE.
  const serious = q.byProblem.filter((p) => ['no_price', 'above_retail', 'no_model', 'vague_category', 'thin_title'].includes(p.key));
  if (!serious.length) return [];
  const n = serious.reduce((a, p) => a + p.count, 0);
  const noPrice = serious.find((p) => p.key === 'no_price');
  return [{
    key: 'biz-listing-quality', area: 'sales', severity: noPrice ? 'medium' : 'low',
    title: `${plural(n, 'listing problem')} across ${q.checked} live units`,
    speak: `${plural(n, 'listing problem')} on the live catalogue: ${serious.slice(0, 3).map((p) => `${p.count} with ${p.label.toLowerCase()}`).join(', ')}`,
    detail: serious.map((p) => `${p.label}: ${p.count} — e.g. ${p.examples.join(', ')}`).join('\n') + '\nFix at the source: the tracker row (the sync overwrites edits made on the site).',
    count: n, link: '/admin/manager/brief'
  }];
}

export const GROWTH_CHECKS = [
  ['sales queue', checkSalesQueue], ['lost demand', checkLostDemand], ['listing quality', checkListingQuality]
];

// ── The whole growth view in one call (page, API, and the voice "morning brief") ──

export async function buildGrowthBrief() {
  const safe = async (f, fallback) => { try { return await f(); } catch { return fallback; } };
  const [sales, demand, listings, pricing] = await Promise.all([
    safe(() => salesQueue({ limit: 12 }), { items: [], counts: {}, waiting: 0 }),
    safe(() => lostDemand({ days: 30 }), { days: 30, total: 0, byCategory: [] }),
    safe(() => listingQuality(), { checked: 0, flagged: 0, byProblem: [], noStockPhoto: [] }),
    safe(() => pricingWatch(), { stale: [], thin: [], aboveRetail: [], trackerRead: false })
  ]);
  return { generatedAt: new Date().toISOString(), sales, demand, listings, pricing };
}

// The lead log: write down every inbound lead the day it arrives, and measure what became of it.
//
// WHY: leads arrive all day (phone, Facebook, partners, lead-generation teams) and nobody could say how many
// came in, which source they came from, or how many we lost because we did not HAVE the appliance they wanted.
// That last number is the one an investor asks about: "your conversion is low because of supply" is a claim until
// somebody has counted it.
//
// Built on the Sales Hub's `leads` table, not beside it, so a lead logged here is the same record the Hub, the
// pipeline board and the partner queue already work (duplicate blocking, ownership, stages, the append-only
// activity log). What this module adds is only: a fast way to write one down, three columns (migration 0073), and
// the funnel report.
//
// Rules that must hold:
//   · BOUGHT IS DERIVED AT READ TIME, never typed. A lead bought when it is linked to a customer or an order exists
//     for its email or phone, placed after the lead was logged. Same reasoning as abandoned carts: it holds however
//     the sale was made (website, invoice, phone) and needs no hook in checkout. It also keeps "Won is never set
//     by hand" true. A lead that was marked lost and later bought is BOUGHT, not lost.
//   · UNRECORDED IS A ROW, NOT A GAP. A lead with no source is counted under "Not recorded", never dropped, so the
//     report cannot read as a complete picture of leads nobody classified.
//   · NO STOCK IS ITS OWN LOST REASON (lead-rules.js), counted separately from price and interest.
//   · RS Solutions B2B leads and imported lists are OUT of this report (they are a different funnel and
//     thousands of rows would swamp the daily consumer leads).
//   · A rep or associate sees the leads THEY own; an admin sees everyone's. The scoping is inside the query,
//     taken from the session's viewer, never from the request.
import { hasDb, query } from './db';
import { createLead, setLeadStage, LeadError } from './leads';
import { LEAD_SOURCES_HUB, WANTED_CATEGORIES, LOST_REASONS, normalizeLeadFields } from './lead-rules';

const norm = (e) => String(e || '').trim().toLowerCase();
const labelOf = (list, key) => (list.find(([k]) => k === key) || [null, null])[1];

const IN_SCOPE = `l.side <> 'rs' AND COALESCE(l.source, '') <> 'imported'`;

// The lead's owner has since bought something: linked to a customer, or an order for their email or phone placed
// after the lead was logged.
const BOUGHT = `(l.customer_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM orders o
   WHERE o.status <> 'cancelled' AND o.created_at >= l.created_at
     AND ((l.email IS NOT NULL AND lower(o.email) = lower(l.email))
       OR (l.phone_key IS NOT NULL AND o.phone IS NOT NULL
           AND right(regexp_replace(o.phone, '\\D', '', 'g'), 10) = right(l.phone_key, 10)))
))`;

let schemaReady = false;
/** The three columns come from migration 0073; this is the safety net for a database that has not run it yet. */
export async function ensureLeadLogSchema() {
  if (schemaReady || !hasDb()) return;
  try {
    await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS wanted text`);
    await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS wanted_category text`);
    await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_detail text`);
    schemaReady = true;
  } catch { /* the page says to run the schema migration */ }
}

/** Write one lead down. Needs a way to reach them and where it came from; everything else can be filled in later. */
export async function logLead(input, viewer) {
  if (!hasDb()) throw new LeadError('Database not configured.', 'nodb');
  const f = normalizeLeadFields(input);
  if (!f.source) throw new LeadError('Say where this lead came from.', 'source');
  if (!f.contactName && !f.company) throw new LeadError('Give a name.');
  await ensureLeadLogSchema();
  const { id } = await createLead({
    ...input, side: 'bb', source: f.source, interestTags: ['appliance_purchase'], temperature: 'warm'
  }, viewer);
  await query(
    `UPDATE leads SET wanted = $2, wanted_category = $3, source_detail = $4 WHERE id = $1`,
    [id, f.wanted, f.wantedCategory, f.sourceDetail]
  );
  return { id };
}

export function leadStatus(row) {
  if (row.bought) return 'bought';
  if (row.stage === 'lost') return 'lost';
  return 'open';
}

function scopeSql(viewer, params) {
  if (viewer?.admin) return '';
  params.push(norm(viewer?.email));
  return ` AND lower(l.owner_email) = $${params.length}`;
}

const clampDays = (d, dflt) => Math.min(Math.max(Math.floor(Number(d)) || dflt, 1), 365);

const ROW = `l.id, l.contact_name, l.company, l.phone, l.email, l.source,
  COALESCE(NULLIF(l.source_detail, ''), l.partner_email) AS detail,
  l.wanted, l.wanted_category, l.stage, l.lost_reason, l.owner_email, l.created_at,
  (l.created_at AT TIME ZONE 'America/Toronto')::date::text AS day,
  ${BOUGHT} AS bought`;

/** Newest first. Each row carries its derived status: open | bought | lost. */
export async function recentLog(viewer, { days = 14, limit = 300 } = {}) {
  if (!hasDb()) return [];
  await ensureLeadLogSchema();
  const params = [String(clampDays(days, 14))];
  const sc = scopeSql(viewer, params);
  params.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
  try {
    const { rows } = await query(
      `SELECT ${ROW} FROM leads l
        WHERE l.created_at >= now() - ($1 || ' days')::interval AND ${IN_SCOPE}${sc}
        ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length}`, params);
    return rows.map((r) => ({ ...r, status: leadStatus(r) }));
  } catch { return []; }
}

/** Partner and team names already used, so "SecondShop" is not also "Second Shop" and "secondshop". */
export async function knownDetails(viewer) {
  if (!hasDb()) return [];
  await ensureLeadLogSchema();
  const params = [];
  const sc = scopeSql(viewer, params);
  try {
    const { rows } = await query(
      `SELECT DISTINCT l.source_detail AS d FROM leads l
        WHERE l.source_detail IS NOT NULL AND l.source_detail <> ''${sc} ORDER BY 1 LIMIT 60`, params);
    return rows.map((r) => r.d);
  } catch { return []; }
}

const pct = (n, d) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);

/**
 * The funnel, from rows shaped like recentLog's. PURE, so it can be tested without a database.
 * conversionPct is of ALL leads in the window (leads still open may yet convert, so it reads low for recent days);
 * decidedPct is bought out of bought + lost.
 */
export function summarizeLeads(rows = []) {
  const total = rows.length;
  const rs = rows.map((r) => ({ ...r, status: leadStatus(r) }));
  const bought = rs.filter((r) => r.status === 'bought').length;
  const lost = rs.filter((r) => r.status === 'lost');
  const open = rs.filter((r) => r.status === 'open').length;

  const lostByReason = {};
  for (const [k] of LOST_REASONS) lostByReason[k] = 0;          // every reason listed, even at zero
  lostByReason.unrecorded = 0;
  for (const r of lost) {
    if (r.lost_reason && r.lost_reason in lostByReason) lostByReason[r.lost_reason] += 1;
    else lostByReason.unrecorded += 1;
  }

  const bySourceMap = new Map();
  for (const r of rs) {
    const key = r.source || '';
    const detail = key === 'partner' || key === 'referral' || key === 'lead_team' ? (r.detail || '') : '';
    const k = `${key}|${detail.toLowerCase()}`;
    if (!bySourceMap.has(k)) {
      bySourceMap.set(k, {
        source: key || null,
        label: key ? (labelOf(LEAD_SOURCES_HUB, key) || key) : 'Not recorded',
        detail: detail || null, leads: 0, bought: 0, lost: 0, noStock: 0, open: 0
      });
    }
    const b = bySourceMap.get(k);
    b.leads += 1;
    if (r.status === 'bought') b.bought += 1;
    else if (r.status === 'lost') { b.lost += 1; if (r.lost_reason === 'no_stock') b.noStock += 1; }
    else b.open += 1;
  }
  const bySource = [...bySourceMap.values()]
    .map((b) => ({ ...b, conversionPct: pct(b.bought, b.leads) }))
    .sort((a, b) => b.leads - a.leads);

  const byDayMap = {};
  for (const r of rs) byDayMap[r.day] = (byDayMap[r.day] || 0) + 1;
  const byDay = Object.keys(byDayMap).sort().map((d) => ({ day: d, leads: byDayMap[d] }));

  // What people asked for that we did not have: the buying signal.
  const missedRows = lost.filter((r) => r.lost_reason === 'no_stock');
  const missedMap = {};
  for (const r of missedRows) {
    const key = r.wanted_category || 'unrecorded';
    missedMap[key] = (missedMap[key] || 0) + 1;
  }
  const missed = Object.entries(missedMap)
    .map(([k, count]) => ({ category: k, label: k === 'unrecorded' ? 'Not recorded' : (labelOf(WANTED_CATEGORIES, k) || k), count }))
    .sort((a, b) => b.count - a.count);
  const missedItems = missedRows.slice(0, 25).map((r) => ({
    id: r.id, day: r.day, wanted: r.wanted || null,
    category: r.wanted_category ? labelOf(WANTED_CATEGORIES, r.wanted_category) : null
  }));

  const noStock = lostByReason.no_stock;
  return {
    total, bought, lost: lost.length, open,
    conversionPct: pct(bought, total),
    decidedPct: pct(bought, bought + lost.length),
    noStock, noStockPct: pct(noStock, total),
    lostByReason, bySource, byDay, missed, missedItems
  };
}

export async function leadFunnel(viewer, { days = 30 } = {}) {
  const d = clampDays(days, 30);
  const rows = await recentLog(viewer, { days: d, limit: 5000 });
  return { days: d, ...summarizeLeads(rows) };
}

/** Mark lost (with a reason) or put back to open. Won is never set here: a sale is derived. */
export async function setLeadOutcome(id, { outcome, lostReason } = {}, viewer) {
  if (outcome === 'lost') return setLeadStage(id, 'lost', { lostReason }, viewer);
  if (outcome === 'open') return setLeadStage(id, 'new', {}, viewer);
  throw new LeadError('Unknown outcome.');
}

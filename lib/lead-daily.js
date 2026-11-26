// The daily call list: every morning each rep on the list gets a set number of NEW leads out of
// the unassigned pool, due today. Who is on it and how many is a setting (`lead_daily`), set by an
// admin on /sales/team — never hard-coded, this repo is public.
//
// Rules:
//   · Safe to run twice: a rep is TOPPED UP to the number for today, counting what they were
//     already given today.
//   · Only a lead nobody owns, still 'new', with a phone number, never touched, and NOT a
//     partner's lead (those have their own claim queue and commission plan).
//   · Best first: warm before cold, then the segments that buy appliances repeatedly, then the
//     towns closest to Pickering. Reps are dealt one each in turn, so neither gets all the good ones.
//   · When the pool cannot cover two more days, the caller is told (the cron emails the office).
import { hasDb, query, withTransaction } from './db';
import { getSetting, setSetting } from './settings';

export const LEAD_DAILY_KEY = 'lead_daily';
export const LEAD_DAILY_BY = 'daily-list';
export const DEFAULT_PER_REP = 20;
export const MAX_PER_REP = 100;

const SEGMENT_ORDER = ['property_management', 'contractor', 'builder', 'stager', 'realtor', 'restoration', 'storage_moving', 'retailer'];
const TOWNS = ['pickering', 'ajax', 'whitby', 'oshawa', 'scarborough', 'markham', 'stouffville', 'uxbridge',
  'bowmanville', 'clarington', 'east york', 'north york', 'richmond hill', 'toronto', 'york', 'vaughan', 'etobicoke'];

const norm = (e) => String(e || '').trim().toLowerCase();
const TODAY = `(now() AT TIME ZONE 'America/Toronto')::date`;
const POOL = `owner_email IS NULL AND partner_email IS NULL AND stage = 'new'
  AND phone IS NOT NULL AND btrim(phone) <> '' AND last_activity_at IS NULL`;

export function normalizeDailyConfig(input = {}) {
  const reps = [...new Set((Array.isArray(input.reps) ? input.reps : String(input.reps || '').split(/[\s,;]+/))
    .map(norm).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))].slice(0, 20);
  const n = Math.round(Number(input.perRep));
  return {
    enabled: input.enabled === true,
    perRep: Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PER_REP) : DEFAULT_PER_REP,
    reps
  };
}

export async function getDailyConfig() {
  return normalizeDailyConfig((await getSetting(LEAD_DAILY_KEY, null)) || {});
}

export async function saveDailyConfig(input) {
  const cfg = normalizeDailyConfig(input);
  if (cfg.enabled && !cfg.reps.length) throw new Error('Add at least one rep email first.');
  await setSetting(LEAD_DAILY_KEY, cfg);
  return cfg;
}

export async function poolSize() {
  if (!hasDb()) return 0;
  const { rows } = await query(`SELECT count(*)::int AS n FROM leads WHERE ${POOL}`);
  return rows[0]?.n || 0;
}

export async function assignDailyLeads() {
  if (!hasDb()) return { ok: false, error: 'no database' };
  const cfg = await getDailyConfig();
  if (!cfg.enabled || !cfg.reps.length) return { ok: true, skipped: 'switched off', assigned: {}, pool: await poolSize(), low: false };

  const assigned = await withTransaction(async (c) => {
    // One run at a time, so the schedule and the button cannot both fill the same day.
    await c.query(`SELECT pg_advisory_xact_lock(724001)`);
    const need = {};
    for (const rep of cfg.reps) {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM leads
          WHERE lower(owner_email) = $1 AND assigned_by = $2
            AND (assigned_at AT TIME ZONE 'America/Toronto')::date = ${TODAY}`, [rep, LEAD_DAILY_BY]);
      need[rep] = Math.max(0, cfg.perRep - (rows[0]?.n || 0));
    }
    const total = Object.values(need).reduce((a, b) => a + b, 0);
    const out = Object.fromEntries(cfg.reps.map((r) => [r, 0]));
    if (!total) return out;

    const town = TOWNS.map((t, i) => `WHEN position('${t}' in lower(coalesce(address,'') || ' ' || coalesce(next_step,''))) > 0 THEN ${i}`).join(' ');
    const { rows: pool } = await c.query(
      `SELECT id FROM leads WHERE ${POOL}
        ORDER BY (temperature = 'cold'),
                 COALESCE(array_position($2::text[], segment), 99),
                 CASE ${town} ELSE 99 END,
                 id
        LIMIT $1 FOR UPDATE`, [total, SEGMENT_ORDER]);

    const hands = Object.fromEntries(cfg.reps.map((r) => [r, []]));
    let i = 0;
    for (const { id } of pool) {
      while (hands[cfg.reps[i % cfg.reps.length]].length >= need[cfg.reps[i % cfg.reps.length]]) i++;
      hands[cfg.reps[i % cfg.reps.length]].push(id);
      i++;
    }
    for (const rep of cfg.reps) {
      if (!hands[rep].length) continue;
      const res = await c.query(
        `UPDATE leads SET owner_email = $1, assigned_by = $2, assigned_at = now(), accepted_at = now(),
                next_step_at = ${TODAY}, next_step = COALESCE(NULLIF(btrim(next_step), ''), 'First call'), updated_at = now()
          WHERE id = ANY($3::int[]) AND owner_email IS NULL`, [rep, LEAD_DAILY_BY, hands[rep]]);
      out[rep] = res.rowCount ?? res.affectedRows ?? hands[rep].length;
    }
    return out;
  });

  const pool = await poolSize();
  return { ok: true, assigned, pool, low: pool < cfg.perRep * cfg.reps.length * 2 };
}

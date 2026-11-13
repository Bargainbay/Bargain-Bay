// Bringing RS Ops' sales CRM into the Sales Hub, once (owner, 2026-11-12).
//
// RS Ops (ops.rssolutions.ca) had a full lead book of its own — calls, emails, tasks —
// that the Hub could not see. This reads it over the shared RSOPS_INTAKE_KEY
// (`GET /api/intake/leads` there), turns each OPEN lead into a Hub lead with
// lib/rsops-lead-map.js, and when the last batch is in, tells RS Ops to lock its lead
// screens so there is one book, not two.
//
// Rules that must hold:
//   · PREVIEW WRITES NOTHING. Commit re-reads RS Ops and re-checks everything.
//   · Safe to run twice: leads.rsops_id is uniquely indexed, so the same RS Ops lead can
//     never land twice, and a re-run reports it as "already here".
//   · The Hub's duplicate rule still applies: a firm the Hub already has (by email, phone
//     or company) is NOT added again and is reported with who owns it.
//   · Committed in batches, because a few thousand leads with their history is more than
//     one request should carry. Each batch stands alone; the screen just keeps going.
//   · RS Ops is locked only after the LAST batch, and only if nothing failed.
import { hasDb, query } from './db';
import { phoneKey, supplierKey } from './constants';
import { findDuplicate } from './leads';
import { mapRsopsLead, torontoDay } from './rsops-lead-map';

export const BATCH = 100;
const base = () => (process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca').replace(/\/+$/, '');
const norm = (e) => String(e || '').trim().toLowerCase();

export class RsopsLeadError extends Error {}

async function rsops(path, init = {}) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) throw new RsopsLeadError('RS Ops is not connected here — set RSOPS_INTAKE_KEY.');
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { 'x-rsops-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    throw new RsopsLeadError(`Could not reach RS Ops (${e.message || e}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) throw new RsopsLeadError('RS Ops does not have the lead export yet — deploy RS Ops first.');
  if (!res.ok) throw new RsopsLeadError(body.error || `RS Ops answered ${res.status}.`);
  return body;
}

/** Every RS Ops lead, mapped, in a fixed order (so batches line up between requests). */
async function readRsops() {
  const data = await rsops('/api/intake/leads');
  const movedOn = torontoDay(new Date());
  const all = (data.leads || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const mapped = all.map((l) => ({ src: l, ...mapRsopsLead(l, { movedOn }) }));
  return { mapped, movedTo: data.movedTo || null };
}

/** What the move WOULD do. Reads the Hub once; writes nothing. */
export async function previewRsopsLeads() {
  if (!hasDb()) throw new RsopsLeadError('Database not configured.');
  const { mapped, movedTo } = await readRsops();
  const { rows } = await query(`SELECT id, lower(email) AS email, phone_key, company_key, owner_email, rsops_id FROM leads`);
  const byRs = new Set(rows.filter((r) => r.rsops_id).map((r) => r.rsops_id));
  const byEmail = new Map(), byPhone = new Map(), byCompany = new Map();
  for (const r of rows) {
    if (r.email) byEmail.set(r.email, r);
    if (r.phone_key) byPhone.set(r.phone_key, r);
    if (r.company_key) byCompany.set(r.company_key, r);
  }

  const out = { total: mapped.length, toImport: 0, dnc: 0, already: 0, duplicates: [], skipped: {}, sample: [], movedTo };
  const seen = { e: new Set(), p: new Set(), c: new Set() };
  for (const m of mapped) {
    if (m.skip) { out.skipped[m.skip] = (out.skipped[m.skip] || 0) + 1; continue; }
    const l = m.lead;
    if (byRs.has(l.rsopsId)) { out.already++; continue; }
    const pk = phoneKey(l.phone), ck = supplierKey(l.company);
    const dup = (l.email && byEmail.get(l.email)) || (pk && byPhone.get(pk)) || (ck && byCompany.get(ck));
    const inFile = (l.email && seen.e.has(l.email)) || (pk && seen.p.has(pk)) || (ck && seen.c.has(ck));
    if (dup || inFile) {
      out.duplicates.push({ name: l.company || l.contactName, owner: dup ? (dup.owner_email || 'unassigned pool') : 'another RS Ops lead in this move', hubId: dup?.id || null });
      continue;
    }
    if (l.email) seen.e.add(l.email);
    if (pk) seen.p.add(pk);
    if (ck) seen.c.add(ck);
    if (m.dnc) out.dnc++; else out.toImport++;
    if (out.sample.length < 12 && !m.dnc) out.sample.push({ name: l.company || l.contactName, stage: l.stage, segment: l.segment, history: m.activities.length - 1, nextStepAt: l.nextStepAt });
  }
  out.duplicates = out.duplicates.slice(0, 200);
  out.batches = Math.ceil(mapped.length / BATCH);
  return out;
}

async function insertOne(m, ownerEmail, by) {
  const l = m.lead;
  const exists = await query(`SELECT id FROM leads WHERE rsops_id = $1`, [l.rsopsId]);
  if (exists.rows.length) return { result: 'already' };
  const dup = await findDuplicate({ email: l.email, phone: l.phone, company: l.company });
  if (dup) return { result: 'duplicate', name: l.company || l.contactName, owner: dup.owner_email || 'unassigned pool', hubId: dup.id };

  const owner = m.dnc ? null : (norm(ownerEmail) || null);
  const { rows } = await query(
    `INSERT INTO leads (side, company, contact_name, email, phone, phone_key, company_key, address, segment, source,
        interest_tags, stage, temperature, est_value, owner_email, assigned_by, assigned_at, first_touch_at,
        next_step, next_step_at, lost_reason, created_by, rsops_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}',$11,$12,$13,$14,$15,
        CASE WHEN $14::text IS NOT NULL THEN now() END, $16::timestamptz, $17, $18::date, $19, $20, $21)
     ON CONFLICT (rsops_id) WHERE rsops_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [l.side, l.company, l.contactName, l.email, l.phone, phoneKey(l.phone), supplierKey(l.company), l.address, l.segment,
     l.source, l.stage, l.temperature, l.estValue, owner, owner ? norm(by) : null, l.firstTouchAt, l.nextStep,
     l.nextStepAt, l.lostReason, norm(by) || null, l.rsopsId]
  );
  if (!rows.length) return { result: 'already' };   // another request got there first
  const id = rows[0].id;
  for (const a of m.activities) {
    await query(
      `INSERT INTO lead_activities (lead_id, kind, outcome, notes, by_email, by_name, occurred_at)
       VALUES ($1,$2,$3,$4,NULL,$5,COALESCE($6::timestamptz, now()))`,
      [id, a.kind, a.outcome, a.notes, String(a.byName || '').slice(0, 200), a.at]
    );
  }
  return { result: m.dnc ? 'dnc' : 'imported', id };
}

/**
 * Bring across one batch, starting at `offset`. Returns counts and `nextOffset`; when that
 * reaches `total`, and nothing in this move failed, RS Ops is told to lock its lead screens.
 */
export async function commitRsopsBatch({ offset = 0, ownerEmail, by, failedSoFar = 0 } = {}) {
  if (!hasDb()) throw new RsopsLeadError('Database not configured.');
  // A blank owner (or 'pool') puts the leads in the unassigned pool; dealRsopsLeads then hands
  // a rep a workable number at a time (owner, 2026-11-12).
  const pool = !norm(ownerEmail) || norm(ownerEmail) === 'pool';
  if (!pool && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm(ownerEmail))) throw new RsopsLeadError('Pick who the leads go to.');
  if (pool) ownerEmail = '';
  const { mapped } = await readRsops();
  const start = Math.max(0, Number(offset) || 0);
  const slice = mapped.slice(start, start + BATCH);
  const counts = { imported: 0, dnc: 0, already: 0, duplicate: 0, skipped: 0, failed: 0 };
  const duplicates = [], failures = [];
  for (const m of slice) {
    if (m.skip) { counts.skipped++; continue; }
    try {
      const r = await insertOne(m, ownerEmail, by);
      counts[r.result]++;
      if (r.result === 'duplicate') duplicates.push({ name: r.name, owner: r.owner, hubId: r.hubId });
    } catch (e) {
      counts.failed++;
      failures.push({ name: m.lead.company || m.lead.contactName, error: String(e.message || e).slice(0, 200) });
    }
  }
  const nextOffset = start + slice.length;
  const done = nextOffset >= mapped.length;
  let locked = null;
  if (done && !counts.failed && !failedSoFar) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM leads WHERE rsops_id IS NOT NULL`);
    const res = await rsops('/api/intake/leads', {
      method: 'POST',
      body: JSON.stringify({ action: 'moved', count: rows[0].n, url: `${process.env.SITE_URL || 'https://bargainbay.ca'}/sales/leads`, by })
    });
    locked = res.movedTo || true;
  }
  return { total: mapped.length, nextOffset, done, counts, duplicates, failures, locked };
}

/** Undo the RS Ops lock (the leads already brought across stay in the Hub). */
export async function reopenRsopsLeads() {
  await rsops('/api/intake/leads', { method: 'POST', body: JSON.stringify({ action: 'reopen' }) });
  return { ok: true };
}

// ---- Dealing them out (owner, 2026-11-12: "100-200 at a time, 20-40 per category") ----
//
// The move lands in the unassigned pool; this gives one rep a workable slice of it. Up to
// `perSegment` from each category and `max` in all, spread round-robin so the cap takes the
// same number from every category rather than emptying the first ones. Within a category the
// warmest go first: furthest stage, then a dated next step, then anyone RS Ops already spoke to.
// Restoration is left out unless asked: its pitch is on hold (lib/sales-content.js).
export const DEAL_MAX = 200;
export const DEAL_PER_SEGMENT_MAX = 50;
const STAGE_RANK = `CASE stage WHEN 'proposal' THEN 4 WHEN 'meeting' THEN 3 WHEN 'conversation' THEN 2 WHEN 'contacted' THEN 1 ELSE 0 END`;
const POOL = `rsops_id IS NOT NULL AND owner_email IS NULL AND stage IN ('new','contacted','conversation','meeting','proposal')`;

/** How many RS Ops leads are waiting in the pool, by category, and what each rep already holds. */
export async function rsopsPoolCounts() {
  if (!hasDb()) return { segments: [], held: [] };
  const [seg, held] = await Promise.all([
    query(`SELECT COALESCE(segment,'other') AS segment, count(*)::int AS n FROM leads WHERE ${POOL} GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT lower(owner_email) AS owner, count(*)::int AS open,
                  count(*) FILTER (WHERE first_touch_at IS NULL)::int AS untouched
             FROM leads WHERE rsops_id IS NOT NULL AND owner_email IS NOT NULL
              AND stage IN ('new','contacted','conversation','meeting','proposal')
            GROUP BY 1`)
  ]);
  return { segments: seg.rows, held: held.rows };
}

export async function dealRsopsLeads({ ownerEmail, perSegment = 30, max = DEAL_MAX, includeRestoration = false, by } = {}) {
  if (!hasDb()) throw new RsopsLeadError('Database not configured.');
  const owner = norm(ownerEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) throw new RsopsLeadError('Pick who the leads go to.');
  const per = Math.min(DEAL_PER_SEGMENT_MAX, Math.max(1, Math.floor(Number(perSegment) || 0)));
  const cap = Math.min(DEAL_MAX, Math.max(1, Math.floor(Number(max) || 0)));
  const excl = includeRestoration ? [] : ['restoration'];
  const { rows } = await query(
    `WITH ranked AS (
       SELECT id, COALESCE(segment,'other') AS segment,
              row_number() OVER (PARTITION BY COALESCE(segment,'other')
                ORDER BY ${STAGE_RANK} DESC, (next_step_at IS NOT NULL) DESC, next_step_at,
                         (first_touch_at IS NOT NULL) DESC, id) AS rn
         FROM leads WHERE ${POOL} AND NOT (COALESCE(segment,'other') = ANY($1::text[]))
     ), picked AS (
       SELECT id FROM ranked WHERE rn <= $2 ORDER BY rn, segment LIMIT $3
     )
     UPDATE leads l SET owner_email = $4, assigned_by = $5, assigned_at = now(), accepted_at = NULL, updated_at = now()
       FROM picked WHERE l.id = picked.id AND l.owner_email IS NULL
     RETURNING COALESCE(l.segment,'other') AS segment`,
    [excl, per, cap, owner, norm(by) || null]
  );
  const bySegment = {};
  for (const r of rows) bySegment[r.segment] = (bySegment[r.segment] || 0) + 1;
  return { assigned: rows.length, bySegment, perSegment: per, max: cap };
}

// The Sales Hub's lead tracker.
//
// Built on what was already here rather than beside it: a lead that becomes a
// customer links to customers.id and the CRM (lib/crm.js) takes over; identities
// are matched with the same phoneKey / supplierKey folding the rest of the app uses.
//
// Rules that must hold (they come from the owner's spec, Addendum 1 and the
// employment agreement):
//   · A REP SEES ONLY THEIR OWN LEADS. Identity is the session's email, never a
//     request parameter. The unassigned pool and everyone else's leads are admin's.
//   · A duplicate is BLOCKED, not merged: same email, same phone or the same
//     company name (case/punctuation folded) as an existing lead says who owns it.
//   · First touch within 24h of assignment or it is flagged; 60 days from the last
//     logged activity and ownership returns to the pool.
//   · WON IS NEVER SET BY HAND. A deal is won when its payment is recorded
//     (Collected Sales), which a later change wires up. Until then 'won' is refused.
//   · The activity log is append-only, like customer_activity.
import { hasDb, query } from './db';
import { phoneKey, supplierKey } from './constants';
import { parseTable } from './stop-import';
import { upsertCustomer } from './customers';
import {
  normalizeLeadFields, isStage, STAGES, OPEN_STAGES, TOUCH_KINDS, ACTIVITY_TYPES, OUTCOMES,
  LOST_REASONS, DAILY_TARGETS, FIRST_TOUCH_HOURS, OWNERSHIP_DAYS
} from './lead-rules';

export class LeadError extends Error {
  constructor(message, code = 'invalid', extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const TODAY = `(now() AT TIME ZONE 'America/Toronto')::date`;
const norm = (e) => String(e || '').trim().toLowerCase();
const rank = (stage) => STAGES.findIndex(([k]) => k === stage);
const COLS = `id, side, company, contact_name, email, phone, address, segment, source, utm_source,
  utm_campaign, interest_tags, stage, temperature, est_value, owner_email, assigned_by, assigned_at,
  accepted_at, first_touch_at, last_activity_at, next_step, next_step_at::text AS next_step_at,
  lost_reason, customer_id, created_by, created_at`;

/** viewer = { email, name, admin }. An admin sees everything; anyone else only their own. */
function scope(viewer, params, alias = '') {
  if (viewer?.admin) return '';
  params.push(norm(viewer?.email));
  return ` AND lower(${alias}owner_email) = $${params.length}`;
}

export async function findDuplicate({ email, phone, company }, { excludeId } = {}) {
  if (!hasDb()) return null;
  const e = norm(email) || null;
  const pk = phoneKey(phone);
  const ck = supplierKey(company);
  if (!e && !pk && !ck) return null;
  const { rows } = await query(
    `SELECT id, company, contact_name, owner_email
       FROM leads
      WHERE ($4::int IS NULL OR id <> $4)
        AND (($1::text IS NOT NULL AND lower(email) = $1)
          OR ($2::text IS NOT NULL AND phone_key = $2)
          OR ($3::text IS NOT NULL AND company_key = $3))
      ORDER BY id LIMIT 1`,
    [e, pk, ck, excludeId || null]
  );
  return rows[0] || null;
}

function duplicateError(dup, viewer) {
  const mine = norm(dup.owner_email) === norm(viewer?.email);
  const who = mine ? 'you' : dup.owner_email ? dup.owner_email : 'the owner’s unassigned pool';
  const name = dup.company || dup.contact_name || `lead #${dup.id}`;
  return new LeadError(
    mine ? `You already have this lead (${name}).` : `Already owned by ${who} (${name}).`,
    'duplicate', { existingId: mine ? dup.id : null }
  );
}

/**
 * Create a lead. A rep's lead is theirs; an admin's goes to `assignTo` or the pool.
 * `source` defaults to self-sourced for a rep.
 */
export async function createLead(input, viewer) {
  if (!hasDb()) throw new LeadError('Database not configured.', 'nodb');
  const f = normalizeLeadFields(input);
  if (!f.company && !f.contactName) throw new LeadError('Give a company or a contact name.');
  if (!f.email && !f.phone) throw new LeadError('A lead needs a phone number or an email.');

  const dup = await findDuplicate(f);
  if (dup) throw duplicateError(dup, viewer);

  const owner = viewer?.admin ? (norm(input.assignTo) || null) : norm(viewer?.email);
  const source = f.source || (viewer?.admin ? (owner ? 'assigned' : null) : 'self_sourced');
  const { rows } = await query(
    `INSERT INTO leads (side, company, contact_name, email, phone, phone_key, company_key, address, segment,
        source, utm_source, utm_campaign, interest_tags, temperature, est_value, owner_email, assigned_by,
        assigned_at, accepted_at, next_step, next_step_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        CASE WHEN $17::text IS NOT NULL THEN now() END,
        CASE WHEN $17::text IS NULL AND $16::text IS NOT NULL THEN now() END,
        $18,$19,$20)
     RETURNING id`,
    [f.side, f.company, f.contactName, f.email, f.phone, phoneKey(f.phone), supplierKey(f.company), f.address,
     f.segment, source, f.utmSource, f.utmCampaign, f.interestTags, f.temperature, f.estValue,
     owner, viewer?.admin && owner ? norm(viewer.email) : null, f.nextStep, f.nextStepAt, norm(viewer?.email) || null]
  );
  return { id: rows[0].id };
}

export async function listLeads({ side, stage, q, owner, limit = 300 } = {}, viewer) {
  if (!hasDb()) return [];
  const params = [];
  let where = 'WHERE true';
  // ADMIN ONLY: look at one rep's leads (or the unassigned pool, owner = 'pool'). For anyone else this is ignored —
  // a rep's view is already their own leads and nothing else.
  if (owner && viewer?.admin) {
    if (owner === 'pool') where += ' AND owner_email IS NULL';
    else { params.push(norm(owner)); where += ` AND lower(owner_email) = $${params.length}`; }
  }
  // A lead belongs to ONE side. Bargain Bay shows only Bargain Bay leads and RS Solutions only RS leads; a lead marked
  // Both shows under All only, so the two sides never repeat each other.
  if (side === 'bb' || side === 'rs') { params.push(side); where += ` AND side = $${params.length}`; }
  if (stage && isStage(stage)) { params.push(stage); where += ` AND stage = $${params.length}`; }
  if (q) {
    params.push(`%${String(q).toLowerCase().slice(0, 80)}%`);
    where += ` AND (lower(coalesce(company,'')) LIKE $${params.length} OR lower(coalesce(contact_name,'')) LIKE $${params.length}
               OR lower(coalesce(email,'')) LIKE $${params.length} OR coalesce(phone,'') LIKE $${params.length})`;
  }
  where += scope(viewer, params);
  params.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
  const { rows } = await query(
    `SELECT ${COLS} FROM leads ${where} ORDER BY (stage IN ('won','lost')), next_step_at NULLS LAST, id DESC LIMIT $${params.length}`,
    params
  ).catch(() => ({ rows: [] }));
  return rows;
}

export async function getLead(id, viewer) {
  if (!hasDb()) return null;
  const params = [Number(id)];
  const { rows } = await query(`SELECT ${COLS} FROM leads WHERE id = $1${scope(viewer, params)}`, params);
  if (!rows[0]) return null;
  const { rows: acts } = await query(
    `SELECT id, kind, outcome, notes, by_name, by_email, occurred_at, next_step_at::text AS next_step_at
       FROM lead_activities WHERE lead_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 300`, [rows[0].id]
  );
  return { ...rows[0], activities: acts };
}

const mustOwn = async (id, viewer) => {
  const lead = await getLead(id, viewer);
  if (!lead) throw new LeadError('Lead not found.', 'notfound');
  return lead;
};

/**
 * Log one activity. The first real touch stamps first_touch_at (which is what the
 * 24-hour SLA looks at), and an outcome moves the stage FORWARD only — never back.
 */
export async function logLeadActivity(id, input, viewer) {
  const lead = await mustOwn(id, viewer);
  const kind = ACTIVITY_TYPES.some(([k]) => k === input.kind) ? input.kind : null;
  if (!kind) throw new LeadError('Pick what kind of activity it was.');
  const outcome = OUTCOMES.some(([k]) => k === input.outcome) ? input.outcome : null;
  const notes = String(input.notes || '').trim().slice(0, 4000) || null;
  const nextAt = /^\d{4}-\d{2}-\d{2}$/.test(String(input.nextStepAt || '')) ? input.nextStepAt : null;
  const touch = TOUCH_KINDS.includes(kind);

  await query(
    `INSERT INTO lead_activities (lead_id, kind, outcome, notes, by_email, by_name, occurred_at, next_step_at)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8)`,
    [lead.id, kind, outcome, notes, norm(viewer?.email) || null, String(viewer?.name || '').slice(0, 200) || null,
     input.occurredAt || null, nextAt]
  );

  let target = null;
  if (outcome === 'conversation') target = 'conversation';
  else if (outcome === 'meeting_booked') target = 'meeting';
  else if (outcome === 'proposal_sent') target = 'proposal';
  else if (touch) target = 'contacted';
  const advance = target && OPEN_STAGES.includes(lead.stage) && rank(target) > rank(lead.stage) ? target : null;

  await query(
    `UPDATE leads SET last_activity_at = now(),
            first_touch_at = CASE WHEN $2::boolean THEN COALESCE(first_touch_at, now()) ELSE first_touch_at END,
            stage = COALESCE($3, stage),
            next_step_at = COALESCE($4::date, next_step_at),
            updated_at = now()
      WHERE id = $1`,
    [lead.id, touch, advance, nextAt]
  );
  return { ok: true, stage: advance || lead.stage };
}

export async function setLeadStage(id, stage, { lostReason } = {}, viewer) {
  const lead = await mustOwn(id, viewer);
  if (!isStage(stage)) throw new LeadError('Unknown stage.');
  if (stage === 'won') {
    throw new LeadError('A deal is Won when its payment is recorded, not when it is moved here.', 'won-by-payment');
  }
  if (stage === 'lost') {
    if (!LOST_REASONS.some(([k]) => k === lostReason)) throw new LeadError('Say why it was lost.', 'reason');
  }
  await query(
    `UPDATE leads SET stage = $2, lost_reason = $3, last_activity_at = now(), updated_at = now() WHERE id = $1`,
    [lead.id, stage, stage === 'lost' ? lostReason : null]
  );
  return { ok: true };
}

/** Admin only (the route checks): give a lead to a rep, or null to put it back in the pool. */
export async function assignLead(id, ownerEmail, by) {
  if (!hasDb()) throw new LeadError('Database not configured.', 'nodb');
  const owner = norm(ownerEmail) || null;
  const { rowCount } = await query(
    `UPDATE leads SET owner_email = $2, assigned_by = $3,
            assigned_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
            accepted_at = NULL, updated_at = now()
      WHERE id = $1`, [Number(id), owner, norm(by) || null]
  );
  if (!rowCount) throw new LeadError('Lead not found.', 'notfound');
  return { ok: true };
}

export async function acceptLead(id, viewer) {
  const lead = await mustOwn(id, viewer);
  await query(`UPDATE leads SET accepted_at = COALESCE(accepted_at, now()), updated_at = now() WHERE id = $1`, [lead.id]);
  return { ok: true };
}

/** What John sees first thing: what was assigned to him, what is due, and today's counters vs target. */
export async function homeSummary(viewer, { side } = {}) {
  const me = norm(viewer?.email);
  const empty = { newAssigned: [], overdue: [], today: [], counters: { touches: 0, conversations: 0, meetings: 0, proposals: 0 }, targets: DAILY_TARGETS };
  if (!hasDb() || !me) return empty;
  const open = `stage IN ('new','contacted','conversation','meeting','proposal')`;
  // The Bargain Bay | RS Solutions toggle narrows the lead lists (a lead marked Both shows under All only). The DAILY COUNTERS
  // are deliberately NOT narrowed: the 40 / 10 / 3 / 1 targets are for the whole job, so a half-day count against the
  // full target would only read as falling behind.
  const one = side === 'bb' || side === 'rs';
  const sideAnd = one ? ` AND side = $2` : '';
  const args = one ? [me, side] : [me];
  const [assigned, due, counts] = await Promise.all([
    query(`SELECT ${COLS} FROM leads WHERE lower(owner_email) = $1 AND assigned_by IS NOT NULL AND accepted_at IS NULL AND ${open}${sideAnd}
            ORDER BY assigned_at DESC LIMIT 50`, args),
    query(`SELECT ${COLS}, (next_step_at < ${TODAY}) AS is_overdue FROM leads
            WHERE lower(owner_email) = $1 AND ${open} AND next_step_at IS NOT NULL AND next_step_at <= ${TODAY}${sideAnd}
            ORDER BY next_step_at LIMIT 100`, args),
    query(`SELECT count(*) FILTER (WHERE kind = ANY($2))::int AS touches,
                  count(*) FILTER (WHERE outcome = 'conversation')::int AS conversations,
                  count(*) FILTER (WHERE outcome = 'meeting_booked')::int AS meetings,
                  count(*) FILTER (WHERE outcome = 'proposal_sent')::int AS proposals
             FROM lead_activities
            WHERE lower(by_email) = $1 AND (occurred_at AT TIME ZONE 'America/Toronto')::date = ${TODAY}`, [me, TOUCH_KINDS])
  ]).catch(() => [{ rows: [] }, { rows: [] }, { rows: [{}] }]);
  return {
    newAssigned: assigned.rows,
    overdue: due.rows.filter((r) => r.is_overdue),
    today: due.rows.filter((r) => !r.is_overdue),
    counters: { touches: 0, conversations: 0, meetings: 0, proposals: 0, ...(counts.rows[0] || {}) },
    targets: DAILY_TARGETS
  };
}

/** Admin: assigned more than FIRST_TOUCH_HOURS ago and still not touched. */
export async function slaBreaches() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT ${COLS} FROM leads
      WHERE owner_email IS NOT NULL AND assigned_at IS NOT NULL AND first_touch_at IS NULL
        AND stage IN ('new','contacted','conversation','meeting','proposal')
        AND assigned_at < now() - ($1 || ' hours')::interval
      ORDER BY assigned_at LIMIT 200`, [String(FIRST_TOUCH_HOURS)]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * Nightly: ownership lasts OWNERSHIP_DAYS from the last logged activity (or from
 * assignment/creation if there never was one). After that the lead goes back to the
 * owner's pool. History is kept; only the owner is cleared.
 */
export async function returnStaleLeads({ days = OWNERSHIP_DAYS } = {}) {
  if (!hasDb()) return 0;
  const { rows } = await query(
    `UPDATE leads SET owner_email = NULL, assigned_at = NULL, accepted_at = NULL, updated_at = now()
      WHERE owner_email IS NOT NULL
        AND stage IN ('new','contacted','conversation','meeting','proposal')
        AND COALESCE(last_activity_at, assigned_at, created_at) < now() - ($1 || ' days')::interval
      RETURNING id`, [String(days)]
  ).catch(() => ({ rows: [] }));
  return rows.length;
}

// ---- CSV / pasted import: preview first, write only on confirm ------------

const HEADER_ALIASES = {
  company: ['company', 'business', 'organization', 'organisation', 'account', 'company name'],
  contactName: ['contact', 'contact name', 'name', 'full name', 'person'],
  email: ['email', 'e mail', 'email address'],
  phone: ['phone', 'telephone', 'mobile', 'cell', 'phone number'],
  address: ['address', 'street address'],
  segment: ['segment', 'type', 'category'],
  side: ['side', 'brand'],
  estValue: ['value', 'est value', 'estimated value', 'deal value'],
  nextStep: ['next step', 'notes', 'note']
};
const hnorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const IMPORT_MAX_ROWS = 300;

function segmentKey(v) {
  const n = hnorm(v);
  if (!n) return null;
  if (/property|landlord|condo/.test(n)) return 'property_management';
  if (/real ?estate|realtor|broker/.test(n)) return 'realtor';
  if (/retail|store/.test(n)) return 'retailer';
  if (/resell|flip/.test(n)) return 'reseller';
  if (/logist|freight|courier|deliver/.test(n)) return 'logistics';
  if (/contract|build|renovat/.test(n)) return 'contractor';
  return null;
}

export async function importLeads(text, viewer, { commit = false, defaultSide = 'both' } = {}) {
  const table = parseTable(String(text || '').slice(0, 1_000_000));
  let { headers, rows } = table;
  if (headers.length && /^Column 1$/.test(headers[0]) && rows.length) { headers = rows[0]; rows = rows.slice(1); }
  if (!rows.length) throw new LeadError('No rows found. The first row must be headings (Company, Contact, Email, Phone…).');
  if (rows.length > IMPORT_MAX_ROWS) throw new LeadError(`That is ${rows.length} rows; up to ${IMPORT_MAX_ROWS} at a time.`);

  const col = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = headers.findIndex((h) => aliases.includes(hnorm(h)));
    if (i >= 0) col[field] = i;
  }
  if (col.company == null && col.contactName == null) throw new LeadError('Could not find a Company or Contact column.');

  const seen = new Set();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const raw = {};
    for (const [f, ix] of Object.entries(col)) raw[f] = r[ix];
    raw.segment = segmentKey(raw.segment);
    raw.side = ['bb', 'rs', 'both'].includes(hnorm(raw.side)) ? hnorm(raw.side) : /bargain/i.test(raw.side || '') ? 'bb' : /rs/i.test(raw.side || '') ? 'rs' : (defaultSide === 'bb' || defaultSide === 'rs' ? defaultSide : 'both');
    raw.source = 'imported';
    const f = normalizeLeadFields(raw);
    const problems = [];
    if (!f.company && !f.contactName) problems.push('no company or contact');
    if (!f.email && !f.phone) problems.push('no phone or email');
    const keys = [f.email && `e:${f.email}`, phoneKey(f.phone) && `p:${phoneKey(f.phone)}`, supplierKey(f.company) && `c:${supplierKey(f.company)}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) problems.push('duplicate of an earlier row in this file');
    let dup = null;
    if (!problems.length) dup = await findDuplicate(f);
    if (dup) problems.push(duplicateError(dup, viewer).message);
    keys.forEach((k) => seen.add(k));
    out.push({ row: i + 2, fields: f, problems });
  }

  const ok = out.filter((r) => !r.problems.length);
  if (!commit) return { rows: out.length, ready: ok.length, skipped: out.length - ok.length, preview: out.slice(0, 200).map((r) => ({ row: r.row, company: r.fields.company, contactName: r.fields.contactName, email: r.fields.email, phone: r.fields.phone, problems: r.problems })) };

  let created = 0; const failed = [];
  for (const r of ok) {
    try { await createLead({ ...r.fields, interestTags: r.fields.interestTags, source: 'imported' }, viewer); created++; }
    catch (e) { failed.push({ row: r.row, error: e.message }); }
  }
  return { created, skipped: out.length - ok.length, failed };
}

// ---- becoming a customer -------------------------------------------------

/**
 * Convert a lead into a customer ("Employee Account").
 *
 * The rep gets the account ONLY when it is genuinely NEW. A lead whose email or phone is already a
 * customer of ours was not brought in by this rep (Addendum 1 rule 4): the lead is linked to the
 * existing customer for the record, but ownership is left alone, and the owner can assign it by hand
 * with a written reason. Converting does NOT mark the lead Won — that waits for a recorded payment.
 */
export async function convertLead(id, viewer) {
  const lead = await mustOwn(id, viewer);
  if (lead.customer_id) throw new LeadError('This lead is already a customer.', 'converted');
  const email = norm(lead.email) || null;
  const key = phoneKey(lead.phone);
  if (!email && !key) throw new LeadError('Add a phone number or an email before converting.');

  const { rows: ex } = await query(
    `SELECT c.id, lower(c.owner_email) AS owner FROM customers c
      WHERE ($1::text IS NOT NULL AND (lower(c.email) = $1
              OR EXISTS (SELECT 1 FROM customer_aliases a WHERE a.customer_id = c.id AND a.kind = 'email' AND a.value = $1)))
         OR ($2::text IS NOT NULL AND (c.phone_key = $2
              OR EXISTS (SELECT 1 FROM customer_aliases a WHERE a.customer_id = c.id AND a.kind = 'phone' AND a.value = $2)))
      ORDER BY c.id LIMIT 1`, [email, key]);

  const owner = norm(lead.owner_email) || null;
  let customerId; let existing = false; let ownsIt = false;
  if (ex[0]) {
    existing = true; customerId = ex[0].id; ownsIt = !!owner && ex[0].owner === owner;
  } else {
    customerId = await upsertCustomer({ email, name: lead.contact_name || lead.company, phone: lead.phone, address: lead.address });
    if (!customerId) throw new LeadError('Could not create the customer.');
    if (owner) {
      await query(
        `UPDATE customers SET owner_email = $2, owner_set_by = $3, owner_set_at = now(), owner_reason = $4 WHERE id = $1 AND owner_email IS NULL`,
        [customerId, owner, norm(viewer?.email) || null, `Converted from lead #${lead.id}`]);
      ownsIt = true;
    }
  }
  await query(`UPDATE leads SET customer_id = $2, updated_at = now() WHERE id = $1`, [lead.id, customerId]);
  await query(
    `INSERT INTO lead_activities (lead_id, kind, notes, by_email, by_name) VALUES ($1,'note',$2,$3,$4)`,
    [lead.id, existing ? 'Linked to an existing customer.' : 'Converted to a new customer.', norm(viewer?.email) || null, String(viewer?.name || '').slice(0, 200) || null]);
  return { ok: true, customerId, existing, ownsIt };
}

// ---- the owner's view of the team -----------------------------------------

export const STALE_DAYS = 5;

/**
 * Where every rep's leads are in the process, and which ones need a hand. ADMIN ONLY (the caller checks).
 *
 * A lead "needs help" when it is open and one of these is true — each is a reason the owner can act on:
 *   · overdue    — its next step was due before today
 *   · stale      — nothing logged for STALE_DAYS (or since it was assigned/created)
 *   · untouched  — assigned more than FIRST_TOUCH_HOURS ago and never contacted
 *   · unaccepted — assigned by the owner and not yet accepted
 */
export async function teamOverview() {
  if (!hasDb()) return { reps: [], pool: { count: 0, value: 0 }, recent: [] };
  const open = `stage IN ('new','contacted','conversation','meeting','proposal')`;
  const [funnel, attention, acts, recent, pool] = await Promise.all([
    query(`SELECT lower(owner_email) AS owner, stage, count(*)::int AS n, COALESCE(sum(est_value),0)::float8 AS value
             FROM leads WHERE owner_email IS NOT NULL GROUP BY 1, 2`),
    query(`SELECT ${COLS}, lower(owner_email) AS owner,
                  (next_step_at IS NOT NULL AND next_step_at < ${TODAY}) AS overdue,
                  (COALESCE(last_activity_at, assigned_at, created_at) < now() - ($1 || ' days')::interval) AS stale,
                  (first_touch_at IS NULL AND assigned_at IS NOT NULL AND assigned_at < now() - ($2 || ' hours')::interval) AS untouched,
                  (assigned_by IS NOT NULL AND accepted_at IS NULL) AS unaccepted
             FROM leads
            WHERE owner_email IS NOT NULL AND ${open}
              AND ((next_step_at IS NOT NULL AND next_step_at < ${TODAY})
                OR COALESCE(last_activity_at, assigned_at, created_at) < now() - ($1 || ' days')::interval
                OR (first_touch_at IS NULL AND assigned_at IS NOT NULL AND assigned_at < now() - ($2 || ' hours')::interval)
                OR (assigned_by IS NOT NULL AND accepted_at IS NULL))
            ORDER BY COALESCE(last_activity_at, assigned_at, created_at) LIMIT 400`, [String(STALE_DAYS), String(FIRST_TOUCH_HOURS)]),
    query(`SELECT lower(by_email) AS owner,
                  count(*) FILTER (WHERE kind = ANY($1) AND (occurred_at AT TIME ZONE 'America/Toronto')::date = ${TODAY})::int AS t_touches,
                  count(*) FILTER (WHERE outcome = 'conversation' AND (occurred_at AT TIME ZONE 'America/Toronto')::date = ${TODAY})::int AS t_conv,
                  count(*) FILTER (WHERE outcome = 'meeting_booked' AND (occurred_at AT TIME ZONE 'America/Toronto')::date = ${TODAY})::int AS t_meet,
                  count(*) FILTER (WHERE outcome = 'proposal_sent' AND (occurred_at AT TIME ZONE 'America/Toronto')::date = ${TODAY})::int AS t_prop,
                  count(*) FILTER (WHERE kind = ANY($1))::int AS a_touches,
                  count(*) FILTER (WHERE outcome = 'conversation')::int AS a_conv,
                  count(*) FILTER (WHERE outcome = 'meeting_booked')::int AS a_meet,
                  count(*) FILTER (WHERE outcome = 'proposal_sent')::int AS a_prop,
                  max(occurred_at) AS last_at
             FROM lead_activities WHERE by_email IS NOT NULL GROUP BY 1`, [TOUCH_KINDS]),
    query(`SELECT a.id, a.kind, a.outcome, a.notes, a.occurred_at, lower(a.by_email) AS owner, a.by_name, l.id AS lead_id, l.company, l.contact_name
             FROM lead_activities a JOIN leads l ON l.id = a.lead_id ORDER BY a.occurred_at DESC, a.id DESC LIMIT 40`),
    query(`SELECT count(*)::int AS n, COALESCE(sum(est_value),0)::float8 AS v FROM leads WHERE owner_email IS NULL AND ${open}`)
  ]).catch((e) => { console.error('teamOverview failed', e.message); return [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ n: 0, v: 0 }] }]; });

  const owners = new Set([...funnel.rows.map((r) => r.owner), ...acts.rows.map((r) => r.owner).filter(Boolean)]);
  const reps = [...owners].sort().map((owner) => {
    const stages = Object.fromEntries(STAGES.map(([k]) => [k, { n: 0, value: 0 }]));
    for (const r of funnel.rows.filter((x) => x.owner === owner)) if (stages[r.stage]) stages[r.stage] = { n: r.n, value: r.value };
    const w = acts.rows.find((x) => x.owner === owner) || {};
    return {
      owner, stages,
      openLeads: OPEN_STAGES.reduce((a, k) => a + stages[k].n, 0),
      openValue: OPEN_STAGES.reduce((a, k) => a + stages[k].value, 0),
      today: { touches: w.t_touches || 0, conversations: w.t_conv || 0, meetings: w.t_meet || 0, proposals: w.t_prop || 0 },
      allTime: { touches: w.a_touches || 0, conversations: w.a_conv || 0, meetings: w.a_meet || 0, proposals: w.a_prop || 0 },
      lastActivityAt: w.last_at || null,
      needsHelp: attention.rows.filter((x) => x.owner === owner)
    };
  });
  return { reps, pool: { count: pool.rows[0]?.n || 0, value: pool.rows[0]?.v || 0 }, recent: recent.rows };
}

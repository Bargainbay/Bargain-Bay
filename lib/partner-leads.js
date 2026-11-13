// Leads sent by a partner organisation's lead generators (Aljo Systems), phase 2.
//
// A partner lead is an ordinary row in the Sales Hub's `leads` table, tagged with the organisation and the generator who
// sent it, so our reps work it with the tools they already have. This module is everything around that: sending one, the
// duplicate rule, what the sender is shown, what the organisation is shown, and the queue our team claims from.
//
// RULES THAT MUST HOLD (each has a test in test/partner-leads.test.mjs):
//   · FIRST IN TIME WINS. A person already in `leads`, already a customer, or already sent by anybody is refused. The
//     second sender is told "already entered by someone else" and NEVER who, when, which organisation or that the person is
//     a customer. Only the organisation's own admin sees who sent a duplicate, and only inside their own organisation.
//   · THE CHECK AND THE INSERT ARE ONE TRANSACTION behind an advisory lock on the phone and the email, with a partial
//     unique index underneath, so two generators sending the same person in the same second cannot both succeed.
//   · THE SENDER SEES A STATUS, NEVER A NUMBER OR A NOTE. Statuses are derived (partnerStatus): "Sold" needs a real counted
//     order for the customer the lead became; nobody can type it. No rep names, no internal notes, no money.
//   · IDENTITY COMES FROM THE SESSION (getPartnerSeat), never the request. A generator reads only their own leads; an
//     organisation admin reads the organisation's; nothing takes an organisation or a member from the request.
//   · A lead whose phone/email is a partner login is refused (self-dealing).
import { hasDb, query, withTransaction } from './db';
import { phoneKey } from './constants';
import { normalizeLeadFields } from './lead-rules';
import { ORDER_MATCH } from './customers';
import { SALE } from './analytics';
import { isDisposableEmail } from './antifraud';
import { sendEmail } from './email';
import { SALES_EMAIL } from './constants';
import { SITE_URL } from './site';
import { listTeam, generatorLink, ensureGeneratorCode } from './referral-partners';
import { LeadError } from './leads';
import {
  HOW_REACHED, WANTS, wantFor, wantLabelFor, partnerStatus, STATUS, SUCCESS, validPhone, validEmail, DUP_OTHER,
  LEADS_PER_10_MIN, LEADS_PER_DAY
} from './partner-lead-rules';

const norm = (e) => String(e || '').trim().toLowerCase();

// Idempotent, and the same as db/migrations/0068: the feature works the moment it is deployed, with nothing for anybody to press.
let ensured = null;
export function ensurePartnerLeadSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_email text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_member_email text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS how_reached text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS notified_at timestamptz;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_member_email text;
      CREATE INDEX IF NOT EXISTS idx_leads_partner ON leads (partner_email, partner_member_email) WHERE partner_email IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_partner_phone ON leads (phone_key) WHERE partner_email IS NOT NULL AND phone_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_partner_email ON leads (lower(email)) WHERE partner_email IS NOT NULL AND email IS NOT NULL;
      CREATE TABLE IF NOT EXISTS partner_notices (
        id serial PRIMARY KEY, partner_email text NOT NULL, member_email text NOT NULL, kind text NOT NULL, lead_id integer,
        text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), seen_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_partner_notices_member ON partner_notices (member_email, created_at DESC);
      CREATE TABLE IF NOT EXISTS partner_dup_attempts (
        id serial PRIMARY KEY, partner_email text NOT NULL, member_email text NOT NULL, name text, phone_key text, email text,
        existing_lead_id integer, existing_kind text, same_member boolean NOT NULL DEFAULT false, same_org boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_partner_dup_partner ON partner_dup_attempts (partner_email, created_at DESC);
    `).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// ---- reading leads with their derived status -----------------------------------------------------------------------------
const SOLD = (extra = '') => `EXISTS (SELECT 1 FROM customers c JOIN orders o ON ${ORDER_MATCH}
   WHERE c.id = l.customer_id AND ${SALE('o')} AND o.created_at >= l.submitted_at ${extra})`;
const LEAD_SELECT = `SELECT l.id, l.contact_name, l.phone, l.email, l.stage, l.lost_reason, l.interest_tags, l.submitted_at,
    l.how_reached, l.intake, l.partner_email, l.partner_member_email, l.owner_email, (l.owner_email IS NOT NULL) AS claimed,
    l.first_touch_at, GREATEST(l.last_activity_at, l.submitted_at) AS changed_at,
    ${SOLD()} AS sold, ${SOLD(`AND o.status = 'delivered'`)} AS delivered
  FROM leads l`;

function dto(r, names = null) {
  const status = partnerStatus(r);
  const out = {
    id: r.id, name: r.contact_name, phone: r.phone, email: r.email,
    wants: wantLabelFor(r.interest_tags || []), howReached: r.how_reached,
    submittedAt: r.submitted_at, changedAt: r.changed_at, status, statusLabel: STATUS[status], success: SUCCESS.includes(status)
  };
  if (names) out.sender = names.get(norm(r.partner_member_email)) || r.partner_member_email;
  return out;
}
const nameMap = async (org) => new Map((await listTeam(org)).map((m) => [norm(m.email), m.name || m.email]));

// Orders placed by the customers credited to each generator (through a lead or their code). Counts only: no money.
async function orderCounts(org) {
  const { rows } = await query(
    `SELECT lower(c.partner_member_email) AS m, COUNT(DISTINCT o.id)::int AS orders,
            COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered
       FROM customers c JOIN orders o ON ${ORDER_MATCH}
      WHERE lower(c.partner_email) = $1 AND c.partner_member_email IS NOT NULL AND ${SALE('o')}
      GROUP BY 1`, [org]);
  return new Map(rows.map((r) => [r.m, r]));
}

/** A generator: only their own. An organisation admin: the organisation's, each with who sent it. `seat` is from getPartnerSeat. */
export async function myLeads(seat) {
  if (!seat) throw new LeadError('Not signed in as a partner.', 'noseat');
  await ensurePartnerLeadSchema();
  const admin = seat.role === 'admin';
  const { rows } = admin
    ? await query(`${LEAD_SELECT} WHERE l.partner_email = $1 ORDER BY l.submitted_at DESC LIMIT 500`, [seat.org])
    : await query(`${LEAD_SELECT} WHERE l.partner_email = $1 AND l.partner_member_email = $2 ORDER BY l.submitted_at DESC LIMIT 500`, [seat.org, seat.email]);
  const names = admin ? await nameMap(seat.org) : null;
  const notices = (await query(
    `SELECT id, kind, lead_id, text, created_at, seen_at FROM partner_notices WHERE member_email = $1 ORDER BY created_at DESC LIMIT 30`, [seat.email])).rows;
  let mine = null;
  if (!admin) {
    const m = (await query(`SELECT code FROM partner_members WHERE member_email = $1 AND removed_at IS NULL`, [seat.email])).rows[0] || { code: null };
    if (!m?.code) m.code = await ensureGeneratorCode(seat.email);          // a generator added before codes existed gets theirs on first look
    const oc = (await orderCounts(seat.org)).get(seat.email) || { orders: 0, delivered: 0 };
    mine = { code: m.code || null, link: m.code ? generatorLink(m.code) : null, discountPct: seat.customerPct || 0, orders: oc.orders, delivered: oc.delivered };
  }
  return { role: seat.role, leads: rows.map((r) => dto(r, names)), notices, mine };
}

export async function markNoticesSeen(seat) {
  if (!seat) return { ok: false };
  await ensurePartnerLeadSchema();
  await query(`UPDATE partner_notices SET seen_at = now() WHERE member_email = $1 AND seen_at IS NULL`, [seat.email]);
  return { ok: true };
}

// ---- sending a lead ------------------------------------------------------------------------------------------------------
async function findDuplicate(c, { email, pk }) {
  const lead = (await c.query(
    `SELECT id, partner_email, partner_member_email FROM leads
      WHERE ($1::text IS NOT NULL AND lower(email) = $1) OR ($2::text IS NOT NULL AND phone_key = $2) ORDER BY id LIMIT 1`, [email, pk])).rows[0];
  if (lead) return { kind: 'lead', lead };
  const cust = (await c.query(
    `SELECT c.id FROM customers c
      WHERE ($1::text IS NOT NULL AND (lower(c.email) = $1
              OR EXISTS (SELECT 1 FROM customer_aliases a WHERE a.customer_id = c.id AND a.kind = 'email' AND a.value = $1)))
         OR ($2::text IS NOT NULL AND (c.phone_key = $2
              OR EXISTS (SELECT 1 FROM customer_aliases a WHERE a.customer_id = c.id AND a.kind = 'phone' AND a.value = $2)))
      ORDER BY c.id LIMIT 1`, [email, pk])).rows[0];
  return cust ? { kind: 'customer' } : null;
}

async function isPartnerLogin({ email, pk }) {
  const { rows } = await query(
    `SELECT lower(u.email) AS email, u.phone FROM users u
      WHERE lower(u.email) IN (SELECT lower(email) FROM referral_partners UNION SELECT lower(member_email) FROM partner_members WHERE removed_at IS NULL)`);
  return rows.some((r) => (email && r.email === email) || (pk && r.phone && phoneKey(r.phone) === pk));
}

/**
 * Send one lead. `seat` comes from getPartnerSeat(session.email). Returns { ok: true, id } or
 * { ok: false, duplicate: 'own' | 'other', ... }. Throws LeadError for a problem the sender can fix.
 */
export async function submitLead(seat, input, { _retry = false } = {}) {
  if (!hasDb()) throw new LeadError('Database not configured.', 'nodb');
  if (!seat) throw new LeadError('Not signed in as a partner.', 'noseat');
  await ensurePartnerLeadSchema();

  const name = String(input?.name || '').trim().slice(0, 120);
  if (name.length < 2) throw new LeadError('Enter the person\'s name.');
  const email = norm(input?.email) || null;
  const phoneRaw = String(input?.phone || '').trim();
  if (!email && !phoneRaw) throw new LeadError('Enter a phone number or an email address.');
  if (phoneRaw && !validPhone(phoneRaw)) throw new LeadError('That phone number does not look right. Enter all 10 digits, including the area code.');
  if (email && (!validEmail(email) || isDisposableEmail(email))) throw new LeadError('That email address does not look right.');
  const want = wantFor(input?.want);
  if (!want) throw new LeadError('Pick what they want.');
  const how = HOW_REACHED.some(([k]) => k === input?.howReached) ? input.howReached : null;
  if (!how) throw new LeadError('Pick how they reached you.');
  const note = String(input?.note || '').trim().slice(0, 600) || null;
  const pk = phoneRaw ? phoneKey(phoneRaw) : null;

  const rate = (await query(
    `SELECT COUNT(*) FILTER (WHERE submitted_at > now() - interval '10 minutes')::int AS recent,
            COUNT(*) FILTER (WHERE submitted_at > now() - interval '24 hours')::int AS day
       FROM leads WHERE partner_member_email = $1`, [seat.email])).rows[0];
  if (rate.recent >= LEADS_PER_10_MIN) throw new LeadError('That is a lot of leads very quickly. Please wait a few minutes.', 'rate');
  if (rate.day >= LEADS_PER_DAY) throw new LeadError(`You have sent ${LEADS_PER_DAY} leads today. Please send the rest tomorrow.`, 'rate');
  if (await isPartnerLogin({ email, pk })) throw new LeadError('That is one of your own team\'s logins, so it cannot be a lead.', 'self');

  const f = normalizeLeadFields({ side: want[2], contactName: name, email, phone: phoneRaw || null, interestTags: want[3] ? [want[3]] : [], temperature: 'warm', source: 'referral' });

  let result;
  try {
    result = await withTransaction(async (c) => {
      const keys = [pk && `p:${pk}`, email && `e:${email}`].filter(Boolean).sort();
      for (const k of keys) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [k]);
      const dup = await findDuplicate(c, { email, pk });
      if (dup) {
        const sameMember = dup.kind === 'lead' && norm(dup.lead.partner_member_email) === seat.email;
        const sameOrg = dup.kind === 'lead' && norm(dup.lead.partner_email) === seat.org;
        await c.query(
          `INSERT INTO partner_dup_attempts (partner_email, member_email, name, phone_key, email, existing_lead_id, existing_kind, same_member, same_org)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [seat.org, seat.email, name, pk, email, dup.lead?.id || null, dup.kind, sameMember, sameOrg]);
        if (!sameMember) {
          await c.query(`INSERT INTO partner_notices (partner_email, member_email, kind, lead_id, text) VALUES ($1,$2,'duplicate',NULL,$3)`,
            [seat.org, seat.email, `${name}: ${DUP_OTHER}`]);
        }
        return { dup: true, sameMember, leadId: sameMember ? dup.lead.id : null };
      }
      const ins = await c.query(
        `INSERT INTO leads (side, contact_name, email, phone, phone_key, source, interest_tags, temperature, partner_email, partner_member_email,
                            intake, how_reached, submitted_at, created_by)
         VALUES ($1,$2,$3,$4,$5,'referral',$6,'warm',$7,$8,'form',$9, now(), $8) RETURNING id`,
        [f.side, f.contactName, f.email, f.phone, pk, f.interestTags, seat.org, seat.email, how]);
      const id = ins.rows[0].id;
      // The generator's note is the first line of the lead's history. by_email is NULL so it never counts toward a rep's daily targets.
      await c.query(
        `INSERT INTO lead_activities (lead_id, kind, notes, by_email, by_name) VALUES ($1,'note',$2,NULL,$3)`,
        [id, `${wantFor(input.want)[1]}. ${HOW_REACHED.find(([k]) => k === how)[1]}.${note ? ' ' + note : ''}`, `${seat.name || seat.email} (partner)`]);
      await c.query(`INSERT INTO partner_notices (partner_email, member_email, kind, lead_id, text) VALUES ($1,$2,'received',$3,$4)`,
        [seat.org, seat.email, id, `${name}: received. Our team will contact them.`]);
      return { dup: false, id };
    });
  } catch (e) {
    // Two requests raced past the lock and the unique index stopped the second: take the duplicate path, once.
    if (e?.code === '23505' && !_retry) return submitLead(seat, input, { _retry: true });
    throw e;
  }

  if (result.dup) {
    if (result.sameMember) {
      const mine = (await query(`${LEAD_SELECT} WHERE l.id = $1`, [result.leadId])).rows[0];
      return { ok: false, duplicate: 'own', message: 'You already sent this person. Here is where it stands.', lead: mine ? dto(mine) : null };
    }
    return { ok: false, duplicate: 'other', message: DUP_OTHER };
  }
  // AWAITED: a serverless instance is frozen the moment the response goes out, so a fire-and-forget send is a coin flip (the
  // lesson from dispatch mail). A mail problem still never fails the lead.
  await notifyTeamOfNewLeads().catch(() => {});
  return { ok: true, id: result.id };
}

// ---- telling our team --------------------------------------------------------------------------------------------------
const notifyList = () => {
  const l = String(process.env.PARTNER_LEAD_NOTIFY_TO || SALES_EMAIL).split(',').map((s) => s.trim()).filter(Boolean);
  return l.length === 1 ? l[0] : l;
};

/** One email per ten minutes at most, however many generators are sending: "N partner leads are waiting". */
export async function notifyTeamOfNewLeads() {
  if (!hasDb()) return { sent: 0 };
  await ensurePartnerLeadSchema();
  const recent = (await query(`SELECT 1 FROM leads WHERE partner_email IS NOT NULL AND notified_at > now() - interval '10 minutes' LIMIT 1`)).rows[0];
  if (recent) return { sent: 0, held: true };
  const { rows } = await query(`UPDATE leads SET notified_at = now() WHERE partner_email IS NOT NULL AND owner_email IS NULL AND stage = 'new' AND notified_at IS NULL RETURNING id`);
  if (!rows.length) return { sent: 0 };
  const n = rows.length;
  const r = await sendEmail({
    to: notifyList(), subject: `${n} new partner lead${n === 1 ? '' : 's'} waiting`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#2e2d2b"><p><b>${n}</b> warm lead${n === 1 ? '' : 's'} from a partner ${n === 1 ? 'is' : 'are'} waiting to be claimed.</p><p><a href="${SITE_URL}/admin/partner-leads">Open the partner leads</a></p></div>`
  });
  if (r && r.ok === false && !r.skipped) await query(`UPDATE leads SET notified_at = NULL WHERE id = ANY($1)`, [rows.map((x) => x.id)]);   // a failed send is retried by the next lead
  return { sent: n };
}

/** Hourly: anything still unclaimed after two hours is chased (each lead at most every three hours). */
export async function remindUnclaimedLeads() {
  if (!hasDb()) return { reminded: 0 };
  await ensurePartnerLeadSchema();
  const { rows } = await query(
    `UPDATE leads SET reminded_at = now()
      WHERE partner_email IS NOT NULL AND owner_email IS NULL AND stage = 'new' AND submitted_at < now() - interval '2 hours'
        AND (reminded_at IS NULL OR reminded_at < now() - interval '3 hours') RETURNING id`);
  if (!rows.length) return { reminded: 0 };
  const n = rows.length;
  const to = [].concat(notifyList());
  const r = await sendEmail({
    to, subject: `${n} partner lead${n === 1 ? '' : 's'} still unclaimed after 2 hours`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#2e2d2b"><p><b>${n}</b> partner lead${n === 1 ? ' has' : 's have'} waited over two hours. The person contacted our partner, so they are expecting to hear from us.</p><p><a href="${SITE_URL}/admin/partner-leads">Claim them now</a></p></div>`
  });
  if (r && r.ok === false && !r.skipped) await query(`UPDATE leads SET reminded_at = NULL WHERE id = ANY($1)`, [rows.map((x) => x.id)]);
  return { reminded: n };
}

// ---- our team's queue ----------------------------------------------------------------------------------------------------
/** viewer = { email, name, admin }. Unclaimed partner leads (everyone sees them), the viewer's own, and for an admin everything in progress. */
export async function partnerLeadQueue(viewer) {
  await ensurePartnerLeadSchema();
  const me = norm(viewer?.email);
  const base = `SELECT l.id, l.contact_name, l.phone, l.email, l.stage, l.lost_reason, l.interest_tags, l.submitted_at, l.how_reached, l.owner_email,
      l.first_touch_at, GREATEST(l.last_activity_at, l.submitted_at) AS changed_at, l.partner_email,
      COALESCE(pm.name, p.name, l.partner_member_email) AS sender, p.name AS org,
      (SELECT notes FROM lead_activities a WHERE a.lead_id = l.id ORDER BY a.id LIMIT 1) AS first_note
    FROM leads l
    LEFT JOIN partner_members pm ON pm.member_email = l.partner_member_email
    LEFT JOIN referral_partners p ON p.email = l.partner_email
   WHERE l.partner_email IS NOT NULL`;
  const unclaimed = (await query(`${base} AND l.owner_email IS NULL AND l.stage = 'new' ORDER BY l.submitted_at`)).rows;
  const mine = (await query(`${base} AND lower(l.owner_email) = $1 ORDER BY (l.stage IN ('lost','won')), l.submitted_at DESC LIMIT 200`, [me])).rows;
  const others = viewer?.admin
    ? (await query(`${base} AND l.owner_email IS NOT NULL AND lower(l.owner_email) <> $1 AND l.stage NOT IN ('lost','won') ORDER BY l.submitted_at DESC LIMIT 200`, [me])).rows : [];
  const shape = (r) => ({
    id: r.id, name: r.contact_name, phone: r.phone, email: r.email, stage: r.stage, lostReason: r.lost_reason,
    wants: wantLabelFor(r.interest_tags || []), howReached: r.how_reached, submittedAt: r.submitted_at, changedAt: r.changed_at,
    sender: r.sender, org: r.org, note: r.first_note, owner: r.owner_email, firstTouch: r.first_touch_at
  });
  return { unclaimed: unclaimed.map(shape), mine: mine.map(shape), others: others.map(shape) };
}

/** Take a lead. Conditional on it still being unowned, so two people pressing at once cannot both get it. */
export async function claimLead(id, viewer) {
  await ensurePartnerLeadSchema();
  const me = norm(viewer?.email);
  if (!me) throw new LeadError('Not signed in.', 'noauth');
  const { rows } = await query(
    `UPDATE leads SET owner_email = $2, assigned_by = $2, assigned_at = now(), accepted_at = now(), updated_at = now()
      WHERE id = $1 AND partner_email IS NOT NULL AND owner_email IS NULL RETURNING id`, [Number(id), me]);
  if (!rows[0]) throw new LeadError('Somebody has already taken that lead.', 'taken');
  await query(`INSERT INTO lead_activities (lead_id, kind, notes, by_email, by_name) VALUES ($1,'note','Claimed.',$2,$3)`,
    [rows[0].id, me, String(viewer?.name || '').slice(0, 200) || null]);
  return { ok: true };
}

// ---- the organisation's own view -----------------------------------------------------------------------------------------
/** Organisation admins only: every generator's numbers and the duplicates refused inside the organisation. */
export async function orgOverview(seat) {
  if (!seat || seat.role !== 'admin') throw new LeadError('Not allowed.', 'forbidden');
  await ensurePartnerLeadSchema();
  const names = await nameMap(seat.org);
  const counts = await orderCounts(seat.org);
  const team = new Map((await listTeam(seat.org)).map((m) => [norm(m.email), m]));
  const rows = (await query(`${LEAD_SELECT} WHERE l.partner_email = $1`, [seat.org])).rows;
  const dups = (await query(
    `SELECT d.member_email, d.name, d.created_at, d.same_member, d.same_org, d.existing_lead_id, l.partner_member_email AS first_sender
       FROM partner_dup_attempts d LEFT JOIN leads l ON l.id = d.existing_lead_id AND d.same_org
      WHERE d.partner_email = $1 ORDER BY d.created_at DESC LIMIT 100`, [seat.org])).rows;
  const by = new Map();
  const get = (e) => { const k = norm(e); if (!by.has(k)) by.set(k, { email: k, name: names.get(k) || k, code: team.get(k)?.code || null, orders: counts.get(k)?.orders || 0, delivered: counts.get(k)?.delivered || 0, sent: 0, withTeam: 0, called: 0, sold: 0, completed: 0, notCounted: 0, unreachable: 0, dups: 0, last: null }); return by.get(k); };
  for (const [e] of names) get(e);
  for (const r of rows) {
    const g = get(r.partner_member_email); const s = partnerStatus(r);
    g.sent += 1;
    if (s !== 'sent') g.withTeam += 1;
    if (['called', 'talking', 'quote', 'sold', 'completed'].includes(s)) g.called += 1;
    if (s === 'sold' || s === 'completed') g.sold += 1;
    if (s === 'completed') g.completed += 1;
    if (s === 'not_counted') g.notCounted += 1;
    if (s === 'couldnt_reach' || s === 'wrong_number') g.unreachable += 1;
    if (!g.last || r.submitted_at > g.last) g.last = r.submitted_at;
  }
  for (const d of dups) get(d.member_email).dups += 1;
  return {
    generators: [...by.values()].sort((a, b) => b.sent - a.sent),
    duplicates: dups.map((d) => ({
      when: d.created_at, name: d.name, sender: names.get(norm(d.member_email)) || d.member_email,
      againstOwn: d.same_member, firstSentBy: d.same_org && !d.same_member ? (names.get(norm(d.first_sender)) || d.first_sender || null) : null,
      kind: d.same_org ? 'your team' : 'already in our system'
    }))
  };
}

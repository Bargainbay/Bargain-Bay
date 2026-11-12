// How one RS Ops sales-CRM lead becomes a Sales Hub lead. NO IMPORTS: pure, so it is
// tested on its own and the rules are in one place (lib/rsops-leads.js does the I/O).
//
// The owner's decisions (2026-11-12): a ONE-TIME move, OPEN leads only, all assigned
// to John. So:
//   · won, lost, archived and closed-as-out-of-business leads stay behind;
//   · a lead marked Do not contact comes across as LOST and UNASSIGNED, so the Hub's
//     duplicate check blocks anybody re-adding the firm and ringing it again;
//   · a lead with no phone AND no email cannot be a Hub lead (the Hub refuses it).
// Nothing about consent is lost: RS Ops records the CASL basis, the Hub has no field
// for it, so it is written into the lead's first note in words.

export const STAGE_MAP = { new: 'new', contacted: 'contacted', qualified: 'conversation', quoted: 'proposal' };
export const SEGMENT_MAP = {
  property_management: 'property_management', restoration: 'restoration', retailer: 'retailer',
  builder: 'builder', contractor: 'contractor', realtor: 'realtor', stager: 'stager',
  storage: 'storage_moving', other: 'other'
};
// An RS Ops call disposition → the Hub's call outcome. A missing entry means "no outcome".
const CALL_OUTCOME = {
  no_answer: 'no_answer', voicemail: 'voicemail', callback: 'conversation', interested: 'conversation',
  quoted: 'proposal_sent', booked: 'conversation', not_now: 'conversation', not_interested: 'not_interested'
};
export const MAX_ACTIVITIES = 100;

const s = (v, max = 300) => { const t = String(v == null ? '' : v).trim().slice(0, max); return t || null; };
const iso = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
/** The Toronto calendar day of an instant, as YYYY-MM-DD. */
export function torontoDay(v) {
  const t = Date.parse(v || '');
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

const CONSENT_WORDS = {
  none: 'no consent on record — do not email until they give it',
  published: 'business address published with no "no solicitation" statement',
  inquiry: 'they enquired (good for six months)',
  express: 'they said yes in writing',
  existing: 'existing business relationship'
};

export function isDoNotContact(l) {
  return l.disposition === 'do_not_contact';
}

/** Why this lead stays in RS Ops, or null if it comes across. */
export function skipReason(l) {
  if (l.archived) return 'archived in RS Ops';
  if (l.closedAt) return 'closed (out of business) in RS Ops';
  if (l.stage === 'won' || l.wonAt) return 'already won in RS Ops';
  if (l.stage === 'lost' && !isDoNotContact(l)) return 'closed as lost in RS Ops';
  if (!s(l.phone) && !s(l.email)) return 'no phone number or email';
  return null;
}

function activityFor(a) {
  const by = s(a.by, 150);
  const name = by ? `${by} (RS Ops)` : 'RS Ops';
  const text = [s(a.what, 300), a.subject ? `Subject: ${s(a.subject, 300)}` : null, s(a.note, 3000)].filter(Boolean).join(' — ');
  const at = iso(a.at);
  if (!at) return null;
  if (a.kind === 'call') return { kind: 'call', outcome: CALL_OUTCOME[a.outcome] || null, notes: text || null, byName: name, at };
  if (a.kind === 'email_out') return { kind: 'email', outcome: null, notes: text || 'Email sent', byName: name, at };
  if (a.kind === 'meeting') return { kind: 'meeting', outcome: 'meeting_booked', notes: text || null, byName: name, at };
  // A reply they sent us, and anything typed as a note, are context, not outreach.
  if (a.kind === 'email_in') return { kind: 'note', outcome: null, notes: `They replied by email: ${text}`.slice(0, 4000), byName: name, at };
  if (a.kind === 'note') return text ? { kind: 'note', outcome: null, notes: text.slice(0, 4000), byName: name, at } : null;
  return null;   // stage changes, assignments, tasks and system lines are bookkeeping, not history worth reading
}

function summaryNote(l, movedOn) {
  const lines = [`Brought over from the RS Ops sales CRM on ${movedOn}.`];
  if (isDoNotContact(l)) lines.push('DO NOT CONTACT — they asked not to be called or emailed (marked in RS Ops). Kept here only so nobody adds them again.');
  if (l.unsubscribedAt) lines.push(`Unsubscribed from our emails on ${torontoDay(l.unsubscribedAt)} — do not email them.`);
  if (l.noSolicit) lines.push(`Their website says it does not want sales messages${l.noSolicit.text ? ` ("${s(l.noSolicit.text, 200)}")` : ''} — call, do not email.`);
  if (l.emailBad) lines.push('The email address bounced in RS Ops — check it before using it.');
  const basis = CONSENT_WORDS[l.consentBasis] || l.consentBasis;
  if (l.email && basis) lines.push(`Email consent (CASL): ${basis}${l.consentSource ? ` — source: ${s(l.consentSource, 300)}` : ''}${l.consentAt ? `, recorded ${torontoDay(l.consentAt)}` : ''}.`);
  const facts = [
    l.title && `Title: ${s(l.title)}`,
    l.website && `Website: ${s(l.website)}`,
    l.size > 0 && `Size: ${l.size}`,
    l.tags?.length && `Tags: ${l.tags.join(', ')}`,
    l.source && `RS Ops source: ${s(l.source)}`,
    l.mapsUrl && `Map: ${s(l.mapsUrl)}`,
    l.owner && `Worked in RS Ops by: ${s(l.owner)}`,
    l.attempts > 0 && `Call attempts: ${l.attempts}`,
    l.disposition && `Last call result: ${String(l.disposition).replace(/_/g, ' ')}`,
    l.lastContactAt && `Last contact: ${torontoDay(l.lastContactAt)}`
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(' · '));
  for (const c of l.contacts || []) {
    const bits = [s(c.name), s(c.title), s(c.phone), s(c.email)].filter(Boolean);
    if (bits.length) lines.push(`Other contact: ${bits.join(', ')}`);
  }
  if (s(l.notes, 3000)) lines.push(`RS Ops notes: ${s(l.notes, 3000)}`);
  for (const t of l.openTasks || []) lines.push(`Open follow-up in RS Ops: ${s(t.title) || 'Follow up'}${t.dueAt ? ` (due ${torontoDay(t.dueAt)})` : ''}`);
  return lines.join('\n').slice(0, 4000);
}

/**
 * One RS Ops lead → { skip } or { lead, activities }. `ownerEmail` is who it is assigned
 * to (Do not contact leads are never assigned). `movedOn` is today's date, for the note.
 */
export function mapRsopsLead(l, { movedOn } = {}) {
  const why = skipReason(l);
  if (why) return { skip: why };
  const dnc = isDoNotContact(l);
  const task = (l.openTasks || [])[0];
  const nextStep = task ? s(task.title) || 'Follow up' : (l.nextAt && !dnc ? 'Call back (from the RS Ops call list)' : null);
  const nextStepAt = task ? torontoDay(task.dueAt) : (l.nextAt && !dnc ? torontoDay(l.nextAt) : null);

  const history = (l.activities || []).map(activityFor).filter(Boolean).slice(-MAX_ACTIVITIES);
  const touches = history.filter((a) => a.kind !== 'note').map((a) => a.at);
  if (!touches.length && l.lastContactAt && iso(l.lastContactAt)) touches.push(iso(l.lastContactAt));
  const stage = dnc ? 'lost' : (STAGE_MAP[l.stage] || 'new');

  return {
    dnc,
    lead: {
      rsopsId: String(l.id),
      side: 'rs',
      company: s(l.company),
      contactName: s(l.contact),
      email: s(l.email, 200)?.toLowerCase() || null,
      phone: s(l.phone, 40),
      address: s(l.city, 300),
      segment: SEGMENT_MAP[l.segment] || 'other',
      source: 'imported',
      temperature: stage === 'conversation' || stage === 'proposal' ? 'warm' : 'cold',
      estValue: Number(l.dealValue) > 0 ? Number(l.dealValue) : null,
      stage,
      lostReason: dnc ? 'other' : null,
      nextStep: nextStep ? nextStep.slice(0, 300) : null,
      nextStepAt,
      // When somebody first actually reached out. Setting it means a lead RS Ops already
      // worked is not flagged as "assigned and never touched" the next morning.
      firstTouchAt: touches.length ? touches.sort()[0] : null
    },
    activities: [
      ...history,
      { kind: 'note', outcome: null, notes: summaryNote(l, movedOn || torontoDay(new Date())), byName: 'RS Ops import', at: null }
    ]
  };
}

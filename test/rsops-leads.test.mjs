// lib/rsops-lead-map.js + lib/rsops-leads.js — the one-time move of RS Ops' sales CRM
// into the Sales Hub (owner, 2026-11-12: open leads only, all to John).
//
// What must hold: won/lost/archived stay behind; Do not contact comes across closed and
// UNASSIGNED; the Hub's duplicate rule still applies; running it twice adds nothing; a lead
// RS Ops already worked is not flagged "never touched"; consent survives as a note; and RS
// Ops is locked only after the last batch, only when nothing failed.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { mapRsopsLead, skipReason } from '../lib/rsops-lead-map.js';
import { previewRsopsLeads, commitRsopsBatch } from '../lib/rsops-leads.js';
import { createLead, slaBreaches, returnStaleLeads } from '../lib/leads.js';

const JOHN = 'john@rssolutions.ca';
const OWNER = 'owner@rssolutions.ca';

const lead = (id, over = {}) => ({
  id, company: `Firm ${id}`, contact: 'Pat', phone: `41655501${String(id).padStart(2, '0')}`, email: `pat${id}@firm.ca`,
  segment: 'property_management', stage: 'new', tags: [], activities: [], openTasks: [], ...over
});

function stubRsops(leads) {
  const calls = [];
  const real = globalThis.fetch;
  process.env.RSOPS_INTAKE_KEY = 'k';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, key: init.headers?.['x-rsops-key'] });
    const payload = init.method === 'POST' ? { ok: true, movedTo: { at: 'now' } } : { leads, movedTo: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

suite('rsops leads — the mapping');

test('only open leads come across', () => {
  equal(skipReason(lead('a', { stage: 'won' })), 'already won in RS Ops');
  equal(skipReason(lead('a', { stage: 'lost' })), 'closed as lost in RS Ops');
  equal(skipReason(lead('a', { archived: true })), 'archived in RS Ops');
  equal(skipReason(lead('a', { closedAt: '2026-10-01' })), 'closed (out of business) in RS Ops');
  equal(skipReason(lead('a', { phone: '', email: '' })), 'no phone number or email');
  equal(skipReason(lead('a', { stage: 'quoted' })), null);
  equal(skipReason(lead('a', { stage: 'lost', disposition: 'do_not_contact' })), null, 'do-not-contact still comes across, closed');
});

test('stages, segments, consent and history are carried over', () => {
  const m = mapRsopsLead(lead('x', {
    stage: 'qualified', segment: 'storage', dealValue: 2500, consentBasis: 'published', consentSource: 'their website', unsubscribedAt: '2026-10-02T15:00:00Z',
    activities: [
      { kind: 'call', at: '2026-10-01T14:00:00Z', by: 'Shemar', outcome: 'voicemail', what: 'Left voicemail' },
      { kind: 'system', at: '2026-10-01T14:01:00Z', by: 'Shemar', what: 'Assigned to Shemar' },
      { kind: 'email_in', at: '2026-10-03T14:00:00Z', by: 'them', what: 'Reply', note: 'Call me Friday' }
    ],
    openTasks: [{ title: 'Ring back Friday', dueAt: '2026-11-14T14:00:00Z' }]
  }), { movedOn: '2026-11-12' });
  equal(m.lead.stage, 'conversation'); equal(m.lead.segment, 'storage_moving'); equal(m.lead.side, 'rs');
  equal(m.lead.temperature, 'warm'); equal(m.lead.estValue, 2500); equal(m.lead.source, 'imported');
  equal(m.lead.nextStep, 'Ring back Friday'); equal(m.lead.nextStepAt, '2026-11-14');
  equal(m.lead.firstTouchAt, '2026-10-01T14:00:00.000Z', 'first real touch, not the reply');
  equal(m.activities.length, 3, 'call + reply + summary note; the system line is dropped');
  equal(m.activities[0].kind, 'call'); equal(m.activities[0].outcome, 'voicemail');
  equal(m.activities[1].kind, 'note', 'a reply is context, not outreach');
  const note = m.activities[2].notes;
  assert(/Unsubscribed from our emails on 2026-10-02/.test(note), 'unsubscribe survives');
  assert(/Email consent \(CASL\)/.test(note) && /their website/.test(note), 'consent basis survives');
});

suite('rsops leads — the move');

test('preview writes nothing and reports what it would do', async () => {
  const { done } = await withTestDb();
  const rs = stubRsops([lead(1), lead(2, { stage: 'won' }), lead(3, { disposition: 'do_not_contact', stage: 'lost' }), lead(4)]);
  try {
    await createLead({ company: 'Someone else', email: 'pat4@firm.ca' }, { email: 'sam@rssolutions.ca', admin: false });
    const p = await previewRsopsLeads();
    equal(p.toImport, 1); equal(p.dnc, 1); equal(p.duplicates.length, 1); equal(p.skipped['already won in RS Ops'], 1);
    equal(p.duplicates[0].owner, 'sam@rssolutions.ca', 'says who already has it');
    const { rows } = await query(`SELECT count(*)::int AS n FROM leads`);
    equal(rows[0].n, 1, 'nothing written');
    equal(rs.calls[0].key, 'k'); assert(rs.calls[0].url.endsWith('/api/intake/leads'), 'reads the export');
  } finally { rs.restore(); await done(); }
});

test('commit assigns open leads to John, closes do-not-contact unassigned, keeps duplicates, and locks RS Ops', async () => {
  const { done } = await withTestDb();
  const rs = stubRsops([
    lead(1, { stage: 'contacted', activities: [{ kind: 'call', at: '2026-09-01T14:00:00Z', by: 'Shemar', outcome: 'no_answer' }] }),
    lead(2),
    lead(3, { disposition: 'do_not_contact', stage: 'lost' }),
    lead(4)
  ]);
  try {
    await createLead({ company: 'Someone else', email: 'pat4@firm.ca' }, { email: 'sam@rssolutions.ca', admin: false });
    const r = await commitRsopsBatch({ offset: 0, ownerEmail: JOHN, by: OWNER });
    equal(r.done, true); equal(r.counts.imported, 2); equal(r.counts.dnc, 1); equal(r.counts.duplicate, 1);
    assert(r.locked, 'RS Ops told to lock');
    const lock = rs.calls.find((c) => c.method === 'POST');
    equal(lock.body.action, 'moved'); equal(lock.body.count, 3);

    const { rows } = await query(`SELECT rsops_id, owner_email, stage, lost_reason, assigned_by, first_touch_at FROM leads WHERE rsops_id IS NOT NULL ORDER BY rsops_id`);
    equal(rows[0].owner_email, JOHN); equal(rows[0].stage, 'contacted'); equal(rows[0].assigned_by, OWNER);
    assert(rows[0].first_touch_at, 'already-worked lead keeps its first touch');
    equal(rows[2].owner_email, null, 'do-not-contact is unassigned'); equal(rows[2].stage, 'lost');
    const sam = await query(`SELECT owner_email FROM leads WHERE email = 'pat4@firm.ca'`);
    equal(sam.rows.length, 1); equal(sam.rows[0].owner_email, 'sam@rssolutions.ca', 'a firm the Hub had stays with its owner');

    const acts = await query(`SELECT kind, by_email, by_name FROM lead_activities a JOIN leads l ON l.id = a.lead_id WHERE l.rsops_id = '1' ORDER BY a.id`);
    equal(acts.rows.length, 2); equal(acts.rows[0].kind, 'call'); equal(acts.rows[0].by_email, null, 'history never counts as John’s');
    equal(acts.rows[0].by_name, 'Shemar (RS Ops)');

    // The already-worked lead is not flagged as never touched; a fresh one is, after 24h.
    await query(`UPDATE leads SET assigned_at = now() - interval '2 days' WHERE rsops_id IS NOT NULL`);
    const breaches = (await slaBreaches()).map((l) => l.company);
    assert(!breaches.includes('Firm 1') && breaches.includes('Firm 2'), 'SLA only for leads nobody ever reached');
    equal(await returnStaleLeads(), 0, 'old RS Ops history does not hand the leads straight back to the pool');
  } finally { rs.restore(); await done(); }
});

test('running it again adds nothing', async () => {
  const { done } = await withTestDb();
  const rs = stubRsops([lead(1), lead(2)]);
  try {
    await commitRsopsBatch({ offset: 0, ownerEmail: JOHN, by: OWNER });
    const again = await commitRsopsBatch({ offset: 0, ownerEmail: JOHN, by: OWNER });
    equal(again.counts.imported, 0); equal(again.counts.already, 2);
    const { rows } = await query(`SELECT count(*)::int AS n FROM leads`);
    equal(rows[0].n, 2);
    const p = await previewRsopsLeads();
    equal(p.already, 2); equal(p.toImport, 0);
  } finally { rs.restore(); await done(); }
});

test('a failure in an earlier batch keeps RS Ops unlocked', async () => {
  const { done } = await withTestDb();
  const rs = stubRsops([lead(1)]);
  try {
    const r = await commitRsopsBatch({ offset: 0, ownerEmail: JOHN, by: OWNER, failedSoFar: 1 });
    equal(r.done, true); equal(r.locked, null);
    assert(!rs.calls.some((c) => c.method === 'POST'), 'no lock call');
  } finally { rs.restore(); await done(); }
});

test('an owner must be given', async () => {
  const { done } = await withTestDb();
  const rs = stubRsops([lead(1)]);
  try {
    let msg = '';
    try { await commitRsopsBatch({ offset: 0, ownerEmail: '', by: OWNER }); } catch (e) { msg = e.message; }
    assert(/Pick who/.test(msg), 'refused');
  } finally { rs.restore(); await done(); }
});

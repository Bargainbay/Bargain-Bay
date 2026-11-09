// lib/leads.js — the Sales Hub's lead tracker.
//
// The rules under test come from the owner's spec and the employment agreement:
// a rep sees only their own leads; a duplicate is blocked and names its owner; the
// first real touch stops the 24-hour clock; 60 days of silence returns ownership;
// and a deal is never "won" by hand.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import {
  createLead, listLeads, getLead, logLeadActivity, setLeadStage, assignLead, acceptLead,
  homeSummary, slaBreaches, returnStaleLeads, importLeads, teamOverview
} from '../lib/leads.js';

const john = { email: 'john@rssolutions.ca', name: 'John Tobias', admin: false };
const sam = { email: 'sam@rssolutions.ca', name: 'Sam', admin: false };
const owner = { email: 'owner@rssolutions.ca', name: 'Owner', admin: true };
const fresh = () => withTestDb();
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };

suite('leads — create, own, and block duplicates');

test('a rep creates a lead and owns it; a lead needs a phone or an email', async () => {
  const { done } = await fresh();
  try {
    const { id } = await createLead({ company: 'Acme Property', contactName: 'Pat', phone: '416-555-0100', side: 'rs', segment: 'property_management' }, john);
    const l = await getLead(id, john);
    equal(l.owner_email, 'john@rssolutions.ca'); equal(l.source, 'self_sourced'); equal(l.stage, 'new');
    assert(await rejects(() => createLead({ company: 'No Contact' }, john)), 'no phone/email is refused');
    assert(await rejects(() => createLead({ phone: '416-555-0199' }, john)), 'no company/contact is refused');
  } finally { await done(); }
});

test('a duplicate by email, phone or company name is blocked and names the owner', async () => {
  const { done } = await fresh();
  try {
    await createLead({ company: 'Acme Property Inc.', email: 'pat@acme.ca', phone: '(416) 555-0100' }, john);
    const err = async (lead, viewer) => { try { await createLead(lead, viewer); } catch (e) { return e; } return null; };
    let e = await err({ company: 'Other', email: 'PAT@acme.ca' }, sam);
    equal(e.code, 'duplicate'); assert(/john@rssolutions\.ca/.test(e.message), 'says who owns it');
    e = await err({ company: 'Other Co', phone: '416.555.0100' }, sam); equal(e.code, 'duplicate');
    e = await err({ company: 'ACME property inc', email: 'x@y.ca' }, sam); equal(e.code, 'duplicate');
    e = await err({ company: 'Acme Property Inc.', email: 'new@acme.ca' }, john);
    assert(/already have/i.test(e.message), 'your own duplicate says so');
  } finally { await done(); }
});

test('a rep sees only their own leads; an admin sees the pool and everyone', async () => {
  const { done } = await fresh();
  try {
    await createLead({ company: 'J1', email: 'j1@x.ca' }, john);
    await createLead({ company: 'S1', email: 's1@x.ca' }, sam);
    await createLead({ company: 'Pool', email: 'p@x.ca' }, owner); // admin, no assignTo -> pool
    equal((await listLeads({}, john)).map((l) => l.company).join(), 'J1');
    equal((await listLeads({}, owner)).length, 3);
    const pool = (await listLeads({}, owner)).find((l) => l.company === 'Pool');
    equal(pool.owner_email, null);
    equal(await getLead(pool.id, john), null, 'a rep cannot open a lead that is not theirs');
    assert(await rejects(() => logLeadActivity(pool.id, { kind: 'call' }, john), 'notfound'));
  } finally { await done(); }
});

test('a lead belongs to ONE side: Both shows under All only, so the two sides never repeat each other', async () => {
  const { done } = await fresh();
  try {
    await createLead({ company: 'BB', email: 'a@x.ca', side: 'bb' }, john);
    await createLead({ company: 'RS', email: 'b@x.ca', side: 'rs' }, john);
    await createLead({ company: 'Both', email: 'c@x.ca', side: 'both' }, john);
    equal((await listLeads({ side: 'bb' }, john)).map((l) => l.company).sort().join(), 'BB');
    equal((await listLeads({ side: 'rs' }, john)).map((l) => l.company).sort().join(), 'RS');
    equal((await listLeads({}, john)).length, 3);
  } finally { await done(); }
});

suite('leads — activity, stages, SLA and ownership');

test('the first touch stamps first_touch_at and moves the stage forward only', async () => {
  const { done } = await fresh();
  try {
    const { id } = await createLead({ company: 'A', email: 'a@x.ca' }, john);
    let r = await logLeadActivity(id, { kind: 'note', notes: 'thinking' }, john);
    equal(r.stage, 'new'); equal((await getLead(id, john)).first_touch_at, null, 'a note is not a touch');
    r = await logLeadActivity(id, { kind: 'call', outcome: 'no_answer' }, john);
    equal(r.stage, 'contacted'); assert((await getLead(id, john)).first_touch_at);
    r = await logLeadActivity(id, { kind: 'call', outcome: 'meeting_booked', nextStepAt: '2030-01-02' }, john);
    equal(r.stage, 'meeting');
    r = await logLeadActivity(id, { kind: 'call', outcome: 'conversation' }, john);
    equal(r.stage, 'meeting', 'never moves back');
    equal((await getLead(id, john)).next_step_at, '2030-01-02');
    equal((await getLead(id, john)).activities.length, 4, 'append-only log');
  } finally { await done(); }
});

test('Won is refused by hand; Lost needs a reason', async () => {
  const { done } = await fresh();
  try {
    const { id } = await createLead({ company: 'A', email: 'a@x.ca' }, john);
    assert(await rejects(() => setLeadStage(id, 'won', {}, john), 'won-by-payment'));
    assert(await rejects(() => setLeadStage(id, 'lost', {}, john), 'reason'));
    await setLeadStage(id, 'lost', { lostReason: 'price' }, john);
    equal((await getLead(id, john)).lost_reason, 'price');
    await setLeadStage(id, 'proposal', {}, john);
    equal((await getLead(id, john)).lost_reason, null, 'reopening clears the reason');
  } finally { await done(); }
});

test('assigning: appears on the rep’s home, Accept clears it, SLA flags a 24h silence', async () => {
  const { done } = await fresh();
  try {
    const { id } = await createLead({ company: 'Warm', email: 'w@x.ca' }, owner);
    await assignLead(id, 'john@rssolutions.ca', owner.email);
    let home = await homeSummary(john);
    equal(home.newAssigned.length, 1);
    await acceptLead(id, john);
    equal((await homeSummary(john)).newAssigned.length, 0);
    equal((await slaBreaches()).length, 0, 'assigned just now is not a breach');
    await query(`UPDATE leads SET assigned_at = now() - interval '25 hours' WHERE id = $1`, [id]);
    equal((await slaBreaches()).length, 1);
    await logLeadActivity(id, { kind: 'call', outcome: 'conversation' }, john);
    equal((await slaBreaches()).length, 0, 'a touch stops the clock');
  } finally { await done(); }
});

test('home: counters count today, follow-ups split overdue and today', async () => {
  const { done } = await fresh();
  try {
    const { id } = await createLead({ company: 'A', email: 'a@x.ca', nextStep: 'call back' }, john);
    await logLeadActivity(id, { kind: 'call', outcome: 'conversation' }, john);
    await logLeadActivity(id, { kind: 'email' }, john);
    await logLeadActivity(id, { kind: 'note' }, john);
    const home = await homeSummary(john);
    equal(home.counters.touches, 2); equal(home.counters.conversations, 1);
    equal(home.targets.touches, 40);
    await query(`UPDATE leads SET next_step_at = (now() AT TIME ZONE 'America/Toronto')::date - 2 WHERE id = $1`, [id]);
    const h2 = await homeSummary(john);
    equal(h2.overdue.length, 1); equal(h2.today.length, 0);
    await query(`UPDATE leads SET next_step_at = (now() AT TIME ZONE 'America/Toronto')::date WHERE id = $1`, [id]);
    const h3 = await homeSummary(john);
    equal(h3.today.length, 1); equal(h3.overdue.length, 0);
  } finally { await done(); }
});

test('60 days from the last activity returns the lead to the pool; recent ones stay', async () => {
  const { done } = await fresh();
  try {
    const a = (await createLead({ company: 'Stale', email: 'a@x.ca' }, john)).id;
    const b = (await createLead({ company: 'Fresh', email: 'b@x.ca' }, john)).id;
    await query(`UPDATE leads SET created_at = now() - interval '90 days', last_activity_at = now() - interval '61 days' WHERE id = $1`, [a]);
    await query(`UPDATE leads SET last_activity_at = now() - interval '59 days' WHERE id = $1`, [b]);
    equal(await returnStaleLeads(), 1);
    equal((await getLead(a, owner)).owner_email, null);
    equal((await getLead(b, owner)).owner_email, 'john@rssolutions.ca');
    equal(await getLead(a, john), null, 'and John can no longer open it');
  } finally { await done(); }
});

suite('leads — import previews first');

test('preview writes nothing, flags duplicates; commit creates only the good rows', async () => {
  const { done } = await fresh();
  try {
    await createLead({ company: 'Existing Co', email: 'e@x.ca' }, sam);
    const csv = [
      'Company,Contact,Email,Phone,Segment',
      'New One,Ann,ann@one.ca,416-555-0001,Property manager',
      'Existing Co,Bob,bob@e.ca,,Retailer',
      'New Two,,,,',
      'New One Again,Ann,ann@one.ca,,'
    ].join('\n');
    const p = await importLeads(csv, john, { commit: false });
    equal(p.ready, 1); equal(p.skipped, 3);
    equal((await listLeads({}, john)).length, 0, 'preview wrote nothing');
    const c = await importLeads(csv, john, { commit: true });
    equal(c.created, 1);
    const mine = await listLeads({}, john);
    equal(mine.length, 1); equal(mine[0].segment, 'property_management'); equal(mine[0].source, 'imported');
  } finally { await done(); }
});

suite('leads — the Bargain Bay | RS Solutions toggle on Home');

test('the toggle narrows the lead lists (Both shows under All only) but never the daily counters', async () => {
  const { done } = await fresh();
  try {
    const day = (await query(`SELECT (now() AT TIME ZONE 'America/Toronto')::date::text AS d`)).rows[0].d;
    const mk = async (company, side) => (await createLead({ company, email: `${company.toLowerCase()}@x.ca`, side, nextStep: 'call', nextStepAt: day }, john)).id;
    const bb = await mk('BBCo', 'bb'); await mk('RSCo', 'rs'); await mk('BothCo', 'both');
    await logLeadActivity(bb, { kind: 'call', outcome: 'conversation', nextStepAt: day }, john);
    const names = (h) => [...h.overdue, ...h.today].map((l) => l.company).sort().join();
    equal(names(await homeSummary(john)), 'BBCo,BothCo,RSCo');
    equal(names(await homeSummary(john, { side: 'bb' })), 'BBCo');
    equal(names(await homeSummary(john, { side: 'rs' })), 'RSCo');
    equal((await homeSummary(john, { side: 'rs' })).counters.touches, 1, 'a Bargain Bay call still counts toward the day when RS is on screen');
  } finally { await done(); }
});

test('an import with no Side column goes to the side being viewed', async () => {
  const { done } = await fresh();
  try {
    await importLeads('Company,Email\nOnly RS Co,a@rs.example.test', john, { commit: true, defaultSide: 'rs' });
    equal((await listLeads({ side: 'rs' }, john)).length, 1);
    equal((await listLeads({ side: 'bb' }, john)).length, 0);
    await importLeads('Company,Email\nUnder All,b@all.example.test', john, { commit: true });
    equal((await listLeads({ side: 'rs' }, john)).length, 1, 'under All a lead with no side is marked Both and stays out of each side');
    equal((await listLeads({}, john)).length, 2);
  } finally { await done(); }
});

suite('leads — the owner’s view of the team');

test('teamOverview: each rep’s funnel, today’s work, and the leads that need a hand with why', async () => {
  const { done } = await fresh();
  try {
    const day = (await query(`SELECT (now() AT TIME ZONE 'America/Toronto')::date::text AS d`)).rows[0].d;
    const a = (await createLead({ company: 'Fresh', email: 'a@x.ca', side: 'bb', nextStepAt: day, estValue: 1000 }, john)).id;
    const b = (await createLead({ company: 'Stale', email: 'b@x.ca', side: 'rs', estValue: 2000 }, john)).id;
    const c = (await createLead({ company: 'Overdue', email: 'c@x.ca', side: 'bb', estValue: 500 }, john)).id;
    await createLead({ company: 'Sams', email: 'd@x.ca', side: 'bb' }, sam);
    await createLead({ company: 'Pool', email: 'e@x.ca', side: 'bb', estValue: 300 }, owner);
    await logLeadActivity(a, { kind: 'call', outcome: 'conversation' }, john);
    await logLeadActivity(b, { kind: 'call', outcome: 'no_answer' }, john);
    await query(`UPDATE leads SET last_activity_at = now() - interval '9 days' WHERE id = $1`, [b]);
    await query(`UPDATE leads SET next_step_at = (now() AT TIME ZONE 'America/Toronto')::date - 3 WHERE id = $1`, [c]);
    await assignLead((await createLead({ company: 'Gifted', email: 'f@x.ca' }, owner)).id, john.email, owner.email);

    const t = await teamOverview();
    const j = t.reps.find((r) => r.owner === 'john@rssolutions.ca');
    equal(j.stages.conversation.n, 1); equal(j.stages.contacted.n, 1); equal(j.stages.new.n, 2);
    equal(j.openLeads, 4); equal(j.today.touches, 2); equal(j.today.conversations, 1); assert(j.lastActivityAt);
    const why = Object.fromEntries(j.needsHelp.map((l) => [l.company, [l.overdue && 'overdue', l.stale && 'stale', l.unaccepted && 'unaccepted'].filter(Boolean).join('+')]));
    equal(why.Stale, 'stale'); equal(why.Overdue, 'overdue'); equal(why.Gifted, 'unaccepted');
    assert(!j.needsHelp.some((l) => l.company === 'Fresh'), 'a lead worked today is not stuck');
    equal(t.pool.count, 1); equal(t.pool.value, 300);
    assert(t.reps.some((r) => r.owner === 'sam@rssolutions.ca'));
    assert(t.recent.length >= 2 && t.recent[0].company, 'the activity feed names the lead');
  } finally { await done(); }
});

test('only an admin can look at another rep’s leads or the pool; a rep’s owner filter is ignored', async () => {
  const { done } = await fresh();
  try {
    await createLead({ company: 'J', email: 'j@x.ca', side: 'bb' }, john);
    await createLead({ company: 'S', email: 's@x.ca', side: 'bb' }, sam);
    await createLead({ company: 'P', email: 'p@x.ca', side: 'bb' }, owner);
    const names = (ls) => ls.map((l) => l.company).sort().join();
    equal(names(await listLeads({ owner: 'john@rssolutions.ca' }, owner)), 'J');
    equal(names(await listLeads({ owner: 'pool' }, owner)), 'P');
    equal(names(await listLeads({}, owner)), 'J,P,S');
    equal(names(await listLeads({ owner: 'sam@rssolutions.ca' }, john)), 'J', 'John asking for Sam’s leads still gets only his own');
    equal(names(await listLeads({ owner: 'pool' }, john)), 'J');
  } finally { await done(); }
});

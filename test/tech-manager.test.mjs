// The Tech Manager and staff texting: the rules, the gate (staff only, operations number,
// production only, logged), the three nudges, the cooldown, and the per-person tone.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  normalizeConfig, DEFAULT_CONFIG, inWindow, matchPerson, mayNudge, messageOk, plainMessage,
  nudgePrompt, techPersonaBlock, TECH_BANTER
} from '../lib/tech-manager-rules.js';

const PROD = () => { process.env.VERCEL_ENV = 'production'; };
const TWILIO = () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok';
  process.env.TWILIO_FROM = '+16475550100'; process.env.TWILIO_MARKETING_FROM = '+16475550199';
};
// Captures every Twilio send; everything else (Anthropic, RS Ops) answers as told.
function stubFetch({ ai = null, bench = null } = {}) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('api.twilio.com')) {
      sent.push(Object.fromEntries(new URLSearchParams(init.body)));
      return new Response(JSON.stringify({ sid: `SM${sent.length}` }), { status: 201 });
    }
    if (u.includes('api.anthropic.com')) {
      return ai == null ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ content: [{ type: 'text', text: ai }] }), { status: 200 });
    }
    if (u.includes('/api/intake/bench')) {
      return bench == null ? new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
        : new Response(JSON.stringify({ units: bench }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { sent, restore: () => { globalThis.fetch = real; } };
}

const DIN = { email: 'din.dinesh4@gmail.com', names: ['Dinesh', 'dinesh din'], banter: true, lang: 'ta' };
async function seedDinesh(client, { phone = '(647) 555-0142', shiftHoursAgo = 12 } = {}) {
  const { rows: [e] } = await client.query(
    `INSERT INTO employees (email, name, phone, hourly_rate) VALUES ($1,'Dinesh',$2,25) RETURNING id`, [DIN.email, phone]);
  if (shiftHoursAgo != null) {
    await client.query(`INSERT INTO staff_shifts (employee_id, started_at, rate) VALUES ($1, now() - ($2 || ' hours')::interval, 25)`, [e.id, String(shiftHoursAgo)]);
  }
  return e;
}
const noon = () => new Date();   // the window is widened in every test that does a real pass, so the clock it runs at is irrelevant
const WIDE = { windowStart: '00:00', windowEnd: '23:59' };

suite('tech manager — rules');

test('settings default to OFF, are clamped, and banter is off unless set on a person', () => {
  const d = normalizeConfig({});
  equal(d.enabled, false);
  equal(d.unitLimitHours, 3);
  equal(normalizeConfig({ unitLimitHours: 99 }).unitLimitHours, 12);
  equal(normalizeConfig({ shiftLimitHours: 0 }).shiftLimitHours, 1);
  const c = normalizeConfig({ people: [{ email: 'A@x.com' }, { email: 'a@x.com', banter: true }, { email: 'not-an-email' }] });
  equal(c.people.length, 1);
  equal(c.people[0].banter, false);
  equal(c.people[0].lang, 'en');
  assert(DEFAULT_CONFIG.enabled === false);
});

test('the send window is inclusive and in Toronto time terms', () => {
  const c = normalizeConfig({});
  assert(inWindow(c, '07:00') && inWindow(c, '22:30') && inWindow(c, '12:00'));
  assert(!inWindow(c, '06:59') && !inWindow(c, '23:00'));
});

test('a unit or shift is matched to ONE configured person, never two', () => {
  const c = normalizeConfig({ people: [DIN, { email: 'dina@x.com', names: ['Dinah'] }] });
  equal(matchPerson(c, { email: 'DIN.dinesh4@gmail.com' }).email, DIN.email);
  equal(matchPerson(c, { name: 'Dinesh (RS Ops)'.replace(/\s*\(.*\)/, '') }).email, DIN.email);
  equal(matchPerson(c, { name: 'Di' }), null);          // too short to be evidence
  equal(matchPerson(c, { name: 'Somebody Else' }), null);
  const twin = normalizeConfig({ people: [{ email: 'a@x.com', names: ['Sam'] }, { email: 'b@x.com', names: ['Sam'] }] });
  equal(matchPerson(twin, { name: 'Sam' }), null);      // ambiguous: texting the wrong person is worse than none
});

test('the cooldown and the daily cap hold', () => {
  const c = normalizeConfig({ cooldownMinutes: 180, maxPerPersonPerDay: 2 });
  const now = Date.now();
  const sent = (minAgo, nudge = 'no_parts', subject = 'U1') => ({ at: now - minAgo * 60_000, nudge, subject });
  equal(mayNudge(c, [sent(60)], { nudge: 'no_parts', subject: 'U1' }, now).ok, false);        // same thing, too soon
  equal(mayNudge(c, [sent(200)], { nudge: 'no_parts', subject: 'U1' }, now).ok, true);        // cooled
  equal(mayNudge(c, [sent(60)], { nudge: 'no_parts', subject: 'U2' }, now).ok, true);         // a different unit
  equal(mayNudge(c, [sent(10, 'a', '1'), sent(20, 'b', '2')], { nudge: 'c', subject: '3' }, now).ok, false);  // daily cap
});

test('a message must still carry the instruction: the unit named, and "clock out" for a shift', () => {
  const n = { kind: 'no_parts', unit: 'SS-1-004', model: 'WM3090CW', hours: 2 };
  assert(messageOk(n, 'SS-1-004 la parts mark pannala, mark pannu'));
  assert(!messageOk(n, 'Enna da, parts mark pannala'));              // jokes but no unit: rejected
  assert(!messageOk(n, 'x'.repeat(500)));
  assert(messageOk({ kind: 'shift_open', hours: 12, since: '9:00' }, 'Still clocked in. Clock out now.'));
  assert(!messageOk({ kind: 'shift_open', hours: 12, since: '9:00' }, 'Go home.'));
  assert(plainMessage({ kind: 'long_on_unit', unit: 'U9', hours: 3.5 }, { lang: 'ta', names: ['Dinesh'] }).includes('U9'));
  assert(plainMessage({ kind: 'shift_open', hours: 12, since: '9:00' }, { lang: 'en', names: ['Dinesh'] }).startsWith('Dinesh, '));
});

test('the BANTER block is only in the prompt when the person has it on, and keeps its limits', () => {
  const on = nudgePrompt({ banter: true, lang: 'ta', names: ['Dinesh'] });
  const off = nudgePrompt({ banter: false, lang: 'en', names: ['Sam'] });
  assert(on.includes('swearing included') && on.includes('Tamil'));
  assert(!off.includes('swearing included') && off.includes('OFF FOR THIS PERSON'));
  assert(/NEVER at the expense of anyone's race, religion/.test(TECH_BANTER));
  assert(/THE JOB IS SAID STRAIGHT/.test(TECH_BANTER));
  assert(/Safety on a repair always wins/.test(TECH_BANTER));
  assert(!techPersonaBlock({ banter: false }).includes('swearing included'));
});

suite('tech manager — texting staff');

test('only staff can be found: a customer or a plain account cannot be texted', async () => {
  const { client, done } = await withTestDb();
  try {
    await client.query(`INSERT INTO users (email, name, phone, password_hash) VALUES ('cust@example.com','Dinesh Customer','6475550177','x')`);
    await client.query(`INSERT INTO users (email, name, phone, password_hash, is_driver) VALUES ('drv@drivers.bargainbay.ca','Dev Driver','6475550188','x', true)`);
    await seedDinesh(client, { shiftHoursAgo: null });
    const { findStaff } = await import('../lib/staff-texts.js');
    const hits = (await findStaff('dinesh')).matches;
    equal(hits.length, 1);                                // the customer named Dinesh is NOT offered
    equal(hits[0].email, DIN.email);
    equal(hits[0].phoneKey, '+16475550142');
    equal((await findStaff('dev driver')).matches[0].source, 'driver');
    equal((await findStaff('cust@example.com')).matches.length, 0);
  } finally { done(); }
});

test('not production: refused and LOGGED; production: sent from the OPERATIONS number and logged', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch();
  try {
    TWILIO();
    await seedDinesh(client, { shiftHoursAgo: null });
    const { findStaff, sendStaffText, recentTexts } = await import('../lib/staff-texts.js');
    const to = (await findStaff('dinesh')).matches[0];
    process.env.VERCEL_ENV = 'preview';
    const a = await sendStaffText({ to, body: 'Clock out' });
    equal(a.ok, false); equal(a.reason, 'not production'); equal(net.sent.length, 0);
    PROD();
    const b = await sendStaffText({ to, body: 'Clock out, Dinesh.', sentBy: 'Manager (AI)' });
    equal(b.ok, true);
    equal(net.sent.length, 1);
    equal(net.sent[0].From, '+16475550100');              // TWILIO_FROM, never the marketing number
    equal(net.sent[0].To, '+16475550142');
    const log = await recentTexts({});
    equal(log.length, 2);
    equal(log[0].status, 'sent'); equal(log[1].status, 'skipped');
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'staff.text'`);
    equal(rows[0].n, 2);
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('a person with no phone on file is skipped and logged, never texted elsewhere', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch();
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { phone: null, shiftHoursAgo: null });
    const { findStaff, sendStaffText } = await import('../lib/staff-texts.js');
    const to = (await findStaff('dinesh')).matches[0];
    const r = await sendStaffText({ to, body: 'hi' });
    equal(r.reason, 'no phone number on file'); equal(net.sent.length, 0);
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

suite('tech manager — the pass');

test('switched OFF, or not production: a real run sends nothing. A dry run still shows what WOULD go', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch({ ai: null });
  try {
    TWILIO();
    await seedDinesh(client);
    const { runTechManager, saveTechConfig, setTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson(DIN);
    PROD();
    equal((await runTechManager({ now: noon() })).skipped, 'switched off');
    await saveTechConfig({ enabled: true, ...WIDE });
    process.env.VERCEL_ENV = 'preview';
    equal((await runTechManager({ now: noon() })).skipped, 'not production');
    const dry = await runTechManager({ dry: true, now: noon(), bench: { ok: true, units: [] } });
    equal(dry.would.length, 1);
    equal(dry.would[0].kind, 'shift_open');
    assert(dry.notes.some((n) => /Not production/.test(n)));
    equal(net.sent.length, 0);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM staff_texts');
    equal(rows[0].n, 0);                                  // a dry run writes nothing
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('a shift still open past the limit is texted ONCE, in Tamil for a Tamil person, then held by the cooldown', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch({ ai: null });                    // AI down: the plain Tamil template must go
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { shiftHoursAgo: 12 });
    const { runTechManager, saveTechConfig, setTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson(DIN);
    await saveTechConfig({ enabled: true, ...WIDE });
    const a = await runTechManager({ now: noon(), bench: { ok: true, units: [] } });
    equal(a.sent.length, 1);
    equal(a.sent[0].ok, true);
    assert(/clock out/i.test(net.sent[0].Body));
    assert(/[஀-௿]/.test(net.sent[0].Body));      // Tamil script
    const b = await runTechManager({ now: noon(), bench: { ok: true, units: [] } });
    equal(b.sent.length, 0);
    equal(b.held[0].why, 'already nudged about this recently');
    equal(net.sent.length, 1);
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('a shift UNDER the limit is not nudged; a configured limit is respected', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch();
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { shiftHoursAgo: 6 });
    const { runTechManager, saveTechConfig, setTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson(DIN);
    await saveTechConfig({ enabled: true, ...WIDE });
    equal((await runTechManager({ now: noon(), bench: { ok: true, units: [] } })).sent.length, 0);
    await saveTechConfig({ shiftLimitHours: 5, ...WIDE });
    equal((await runTechManager({ now: noon(), bench: { ok: true, units: [] } })).sent.length, 1);
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('RS Ops: no parts marked, and more than 3 hours on one unit; a unit with parts marked is fine', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch({ ai: 'SS-9-001 parts mark pannu' });
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { shiftHoursAgo: null });
    const { runTechManager, saveTechConfig, setTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson(DIN);
    await saveTechConfig({ enabled: true, ...WIDE });
    const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    const units = [
      { id: 'SS-9-001', model: 'WM3090CW', assignedToName: 'Dinesh', workingSince: ago(2), partsMarked: false },   // no parts, 2h
      { id: 'SS-9-002', model: 'GE123', assignedToName: 'Dinesh', workingSince: ago(4), partsMarked: true },       // 4h on it, parts marked
      { id: 'SS-9-003', model: 'X', assignedToName: 'Somebody Else', workingSince: ago(9), partsMarked: false },   // not a managed person
      { id: 'SS-9-004', model: 'Y', assignedToName: 'Dinesh', workingSince: ago(0.2), partsMarked: false }         // just started: grace
    ];
    const r = await runTechManager({ now: new Date(), bench: { ok: true, units } , dry: true });
    // dry run needs the window; use `would` regardless of the window note
    const kinds = r.would.map((w) => `${w.kind}:${w.label || ''}`);
    equal(r.would.length, 2);
    assert(r.would.some((w) => w.kind === 'no_parts'));
    assert(r.would.some((w) => w.kind === 'long_on_unit'));
    assert(r.would.find((w) => w.kind === 'no_parts').body.includes('SS-9-001'));
    equal(net.sent.length, 0);
    void kinds;
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('an AI message that drops the instruction is replaced by the plain one', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch({ ai: 'Enna da lazy fellow' });   // no unit number
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { shiftHoursAgo: null });
    const { composeNudge } = await import('../lib/tech-manager.js');
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const r = await composeNudge({ kind: 'no_parts', unit: 'SS-1-004', model: 'M', hours: 2 }, DIN);
    equal(r.by, 'template');
    assert(r.body.includes('SS-1-004'));
    const ok = stubFetch({ ai: 'SS-1-004 parts mark pannala, pannu da' });
    const r2 = await composeNudge({ kind: 'no_parts', unit: 'SS-1-004', model: 'M', hours: 2 }, DIN);
    equal(r2.by, 'ai');
    ok.restore();
  } finally { delete process.env.ANTHROPIC_API_KEY; net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('RS Ops unreachable: the shift nudges still go and the report says the others did not run', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch({ bench: null });                 // /api/intake/bench -> 404
  try {
    TWILIO(); PROD();
    process.env.RSOPS_INTAKE_KEY = 'k';
    await seedDinesh(client, { shiftHoursAgo: 12 });
    const { runTechManager, saveTechConfig, setTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson(DIN);
    await saveTechConfig({ enabled: true, ...WIDE });
    const r = await runTechManager({ now: noon() });
    equal(r.sent.length, 1);
    assert(/not found/.test(r.benchError));
    assert(r.notes.some((n) => /did not run/.test(n)));
  } finally { delete process.env.RSOPS_INTAKE_KEY; net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('banter is per person: setting one person does not touch another, and a partial post keeps it', async () => {
  const { done } = await withTestDb();
  try {
    const { setTechPerson, getTechConfig, removeTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson({ email: 'a@x.com', names: ['Ann'], banter: true, lang: 'ta' });
    await setTechPerson({ email: 'b@x.com', names: ['Bob'] });
    let c = await getTechConfig();
    equal(c.people.find((p) => p.email === 'a@x.com').banter, true);
    equal(c.people.find((p) => p.email === 'b@x.com').banter, false);
    await setTechPerson({ email: 'a@x.com', names: ['Ann', 'Annie'] });   // names only: banter and lang stay
    c = await getTechConfig();
    const a = c.people.find((p) => p.email === 'a@x.com');
    equal(a.banter, true); equal(a.lang, 'ta'); equal(a.names.length, 2);
    await setTechPerson({ email: 'a@x.com', banter: false });
    equal((await getTechConfig()).people.find((p) => p.email === 'a@x.com').banter, false);
    await removeTechPerson('b@x.com');
    equal((await getTechConfig()).people.length, 1);
  } finally { done(); }
});

suite('tech manager — the Manager team and the assistant');

test('the Tech Manager hat has the text tools; none of the staff-text tools can reach a customer', async () => {
  const { DEPTS, toolsFor, isGated } = await import('../lib/manager-policy.js');
  const { TOOLS } = await import('../lib/manager-tools.js');
  const { TOOLS_B } = await import('../lib/manager-tools-b.js');
  const all = [...TOOLS, ...TOOLS_B];
  const names = toolsFor('tech', all).map((t) => t.name);
  assert(names.includes('text_employee') && names.includes('tech_status') && names.includes('switch_department'));
  assert(!names.some((n) => /invoice|refund|payment|price|coupon|credit/.test(n)), 'the tech hat holds no money tool');
  assert(toolsFor('delivery', all).some((t) => t.name === 'text_employee'));
  assert(toolsFor('gm', all).some((t) => t.name === 'text_employee'));
  assert(!toolsFor('sales', all).some((t) => t.name === 'text_employee'));
  assert(!/^(send_|email_customer)/.test('text_employee'));
  assert(DEPTS.tech.tools.includes('text_employee') && all.some((t) => t.name === 'text_employee') && all.some((t) => t.name === 'tech_status'));
  assert(!isGated('text_employee'));
});

test('the Manager can text a staff member by name, and cannot text anyone else', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch();
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { shiftHoursAgo: null });
    await client.query(`INSERT INTO users (email, name, phone, password_hash) VALUES ('cust@example.com','Dinesh Customer','6475550177','x')`);
    const { runToolB } = await import('../lib/manager-tools-b.js');
    const none = await runToolB('text_employee', { who: 'nobody here', message: 'hi' }, { dept: 'tech' });
    assert(none.error);
    const ok = await runToolB('text_employee', { who: 'Dinesh', message: 'SS-1-004 parts mark pannu' }, { dept: 'tech' });
    equal(ok.ok, true);
    equal(net.sent.length, 1);
    equal(net.sent[0].To, '+16475550142');
    const { rows } = await client.query(`SELECT sent_by, kind FROM staff_texts`);
    equal(rows[0].sent_by, 'Tech Manager (AI)'); equal(rows[0].kind, 'manual');
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

test('the assistant\'s text tool is a CONFIRMED write, and only the owner (admin) is given it', async () => {
  const { ALL_TOOLS, toolsForPerson } = await import('../lib/assistant/tools.js');
  const t = ALL_TOOLS.find((x) => x.name === 'text_employee');
  assert(t && t.write === true && typeof t.prepare === 'function' && typeof t.execute === 'function');
  equal(t.teams.join(), 'manager');
  const mk = (teams) => toolsForPerson({ teams }).mine.map((x) => x.name);
  assert(mk(['manager']).includes('text_employee'));
  assert(!mk(['driver']).includes('text_employee'));
  assert(!mk(['sales', 'warehouse']).includes('text_employee'));
});

test('admin sessions get the manager team; sales, drivers and RS Ops crew do not', async () => {
  const was = { a: process.env.ADMIN_EMAILS, s: process.env.SALES_EMAILS };   // restored below: other test files rely on them
  process.env.ADMIN_EMAILS = 'boss@example.com'; process.env.SALES_EMAILS = 'rep@example.com';
  const { personFromSession, personFromRsops } = await import('../lib/assistant/people.js');
  const boss = await personFromSession({ userId: 1, email: 'boss@example.com', name: 'Boss' });
  assert(boss.teams.includes('manager'));
  const rep = await personFromSession({ userId: 2, email: 'rep@example.com', name: 'Rep' });
  assert(!rep.teams.includes('manager'));
  assert(!personFromRsops({ name: 'Dinesh' }).teams.includes('manager'));
  if (was.a === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = was.a;
  if (was.s === undefined) delete process.env.SALES_EMAILS; else process.env.SALES_EMAILS = was.s;
});

test('outside the send window a real pass does nothing, and says so', async () => {
  const { client, done } = await withTestDb();
  const net = stubFetch();
  try {
    TWILIO(); PROD();
    await seedDinesh(client, { shiftHoursAgo: 12 });
    const { runTechManager, saveTechConfig, setTechPerson } = await import('../lib/tech-manager.js');
    await setTechPerson(DIN);
    await saveTechConfig({ enabled: true, windowStart: '03:00', windowEnd: '03:01' });
    const at = new Date('2026-11-18T17:00:00Z');                 // 12:00 / 13:00 Toronto: outside 03:00-03:01
    const r = await runTechManager({ now: at, bench: { ok: true, units: [] } });
    assert(/outside 03:00-03:01/.test(r.skipped));
    equal(net.sent.length, 0);
  } finally { net.restore(); delete process.env.VERCEL_ENV; done(); }
});

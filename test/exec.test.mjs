// The General Manager: judged against the kinds of situation this business
// actually has (paid days with nothing recorded, a stuck repair queue, finished
// units nobody can buy, two spellings of one rep, a source that cannot be read).
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  monthWindows, matchByName, peopleReview, floorFlow, rankPlays, assignTargets, measure, judgeAssignment, streamBoard, verdictLine, assignmentText
} from '../lib/exec-rules.js';
import { gatherFacts } from '../lib/exec-data.js';
import { buildReview, runExecPass, textTargets, saveExecConfig, assignmentsOn, cleanJudgement, briefHtml, reviewForCall, judgeEarlier, setTargets } from '../lib/exec.js';
import { scanIssues } from '../lib/manager-issues.js';

const TODAY = '2026-11-26';

suite('general manager — judgement');

test('a part month is compared with the same days of last month', () => {
  const w = monthWindows(TODAY);
  equal([w.from, w.prevFrom, w.prevTo, w.day, w.daysInMonth], ['2026-11-01', '2026-10-01', '2026-10-26', 26, 30]);
  equal(monthWindows('2026-03-30').prevTo, '2026-02-28');
  const [s] = streamBoard([{ key: 'a', now: 130, before: 100 }], w);
  equal([s.change, s.runRate], [30, 150]);
  equal(streamBoard([{ key: 'a', now: null, before: 100 }], w)[0].change, null);
});

test('one human is matched across systems, and two Johns match nobody', () => {
  const people = [{ name: 'John Tomais' }, { name: 'Nicholas Carter' }, { name: 'Roushi' }];
  equal(matchByName('john tobias', people)?.name, 'John Tomais');
  equal(matchByName('Roushi Sharma', people)?.name, 'Roushi');
  equal(matchByName('john', [...people, { name: 'John Smith' }]), null);
});

const shift = (person, email, day, extra = {}) => ({ source: 'staff', person, email, day, hours: 8, rate: 20, status: 'ok', ...extra });

test('paid days with nothing recorded are raised as a question, and a driving day never is', () => {
  const people = peopleReview({
    today: TODAY,
    shifts: [
      shift('Nick', 'nick@x.ca', '2026-11-18'), shift('Nick', 'nick@x.ca', '2026-11-19'), shift('Nick', 'nick@x.ca', '2026-11-20'), shift('Nick', 'nick@x.ca', '2026-11-21'),
      shift('Andre', 'andre@x.ca', '2026-11-18', { source: 'driver' }), shift('Andre', 'andre@x.ca', '2026-11-19', { source: 'driver' }),
      shift('Nick', 'nick@x.ca', TODAY, { status: 'open' })
    ],
    floor: [{ name: 'Nick', days: { '2026-11-19': { assessed: 12, photographed: 12 } } }, { name: 'Admin', days: { '2026-11-19': { qa: 30 } } }]
  });
  const nick = people.find((p) => p.name === 'Nick');
  equal(nick.blankDays, ['2026-11-18', '2026-11-20', '2026-11-21']);
  assert(nick.flags[0].text.includes('ask'), nick.flags[0].text);
  equal(nick.cost, 640);
  assert(!nick.flags.some((f) => f.key === 'open_shift'));     // still working today is normal
  equal(people.find((p) => p.name === 'Andre').flags.length, 0);
  assert(!people.some((p) => p.name === 'Admin'), 'a shared login is nobody');
});

test('a rep is weighed on gross profit against wages, and the company login is not made into staff', () => {
  const people = peopleReview({
    today: TODAY, shifts: [shift('John Tomais', 'john@x.ca', '2026-11-20', { hours: 40, rate: 25 })],
    sales: [{ name: 'john tobias', email: null, revenue: 900, profit: 300, calls: 0, reached: 0, invoices: 1, quotes: 0, days: ['2026-11-20'] },
      { name: 'Website', email: null, revenue: 5000, profit: 2000, days: [] }]
  });
  equal(people.length, 1);
  equal(people[0].sales.profit, 300);
  assert(people[0].flags.some((f) => f.key === 'sales_below_cost'));
});

const unit = (id, status, since, extra = {}) => ({ id, status, since, arrived: true, ...extra });

test('the floor names the bottleneck, and finished units nobody can buy', () => {
  const now = new Date(`${TODAY}T15:00:00Z`);
  const f = floorFlow({
    now,
    units: [
      ...Array.from({ length: 8 }, (_, i) => unit(`R-${i}`, 'repair', '2026-11-10T12:00:00Z')),
      unit('C-1', 'cleaning', '2026-11-25T12:00:00Z'),
      unit('A-1', 'ready', '2026-11-01T12:00:00Z'), unit('a-2', 'ready', '2026-11-20T12:00:00Z'), unit('A-3', 'ready', '2026-11-20T12:00:00Z'),
      unit('E-1', 'draft', null, { arrived: false }), unit('M-1', 'misc', null), unit('CL-1', 'ready', null, { own: false })
    ],
    workers: [{ name: 'Nick', days: { '2026-11-24': { cleaned: 20 }, '2026-11-25': { cleaned: 10 } } }],
    onSite: new Set(['A-2']), sold: new Set(['A-3'])
  });
  equal(f.constraint.key, 'repair');
  equal(f.constraint.stalled, true);
  equal(f.stages.find((s) => s.key === 'cleaning').daysToClear, 1);
  equal(f.readyNotOnSite.map((u) => u.id), ['A-1']);
  equal(f.parked, 1);
  // Without the tracker we cannot tell sold from hidden, so nothing is claimed.
  equal(floorFlow({ units: [unit('A-1', 'ready', null)], onSite: null, sold: null }).readyNotOnSite, null);
});

test('moves are ranked by cash that can be had, and say what their figure is', () => {
  const plays = rankPlays({
    money: { overdue: { count: 3, total: 9000, top: [] }, quotes: { count: 4, total: 9000 }, doorMoney: { count: 0, total: 0 }, unbilled: { count: 2, total: 190, clients: ['CDA'] } },
    avgPrice: 500, flow: { readyNotOnSite: [{ id: 'A-1' }, { id: 'A-2' }], constraint: null }
  });
  equal(plays[0].key, 'collect');
  assert(plays.every((p) => p.basis && p.action));
  assert(plays.find((p) => p.key === 'list-ready').basis.startsWith('estimate'));
  assert(!plays.some((p) => p.key === 'door-money'), 'nothing to confirm is not a move');
});

test('targets come from each person\'s own typical day and today\'s run, and are judged from the same records', () => {
  const people = [
    { name: 'Roushi', email: 'r@x.ca', kinds: ['floor'], floorByDay: { '2026-11-18': { cleaned: 2 }, '2026-11-19': { cleaned: 20 }, '2026-11-25': { cleaned: 23 } }, callsByDay: {}, sales: null },
    { name: 'John Tomais', email: 'j@x.ca', kinds: ['sales'], floorByDay: {}, callsByDay: { '2026-11-25': 23 }, sales: { calls: 23 } },
    { name: 'Gone', email: 'g@x.ca', kinds: ['floor'], floorByDay: { '2026-11-01': { cleaned: 5 } }, callsByDay: {}, sales: null }
  ];
  const t = assignTargets({ people, today: TODAY, flow: { stages: [{ key: 'cleaning', count: 40 }] }, todayStops: [{ name: 'Andre', email: 'a@x.ca', count: 6 }] });
  equal(t.map((a) => [a.name, a.metric, a.target]), [['Andre', 'stops_proof', 6], ['Roushi', 'cleaned', 21], ['John Tomais', 'calls', 20]]);
  assert(assignmentText(t[1]).startsWith('Roushi, today\'s target: 21 units cleaned'));
  const facts = { people: [{ name: 'Roushi', email: 'r@x.ca', days: ['2026-11-26'], floorByDay: { '2026-11-26': { cleaned: 12 } } }], stopDays: { 'a@x.ca|2026-11-26': 6 } };
  const r = measure(t[1], TODAY, facts);
  equal(judgeAssignment(t[1], r.actual, r.worked), { status: 'short', actual: 12 });
  const a = measure(t[0], TODAY, facts);
  equal(judgeAssignment(t[0], a.actual, a.worked).status, 'met');
  const j = measure(t[2], TODAY, facts);
  equal(judgeAssignment(t[2], j.actual, j.worked).status, 'off');
});

test('somebody on the daily call list owes those calls as well as their floor target', () => {
  const t = assignTargets({ today: TODAY, callList: { enabled: true, perRep: 20, reps: ['r@x.ca'] }, flow: { stages: [{ key: 'cleaning', count: 9 }] },
    people: [{ name: 'Roushi', email: 'r@x.ca', kinds: ['floor'], floorByDay: { '2026-11-25': { cleaned: 5 } }, callsByDay: {}, sales: { calls: 0 } }] });
  equal(t.map((a) => [a.metric, a.target]), [['calls', 20], ['cleaned', 6]]);
});

test('client work with no invoice here is a thing to check until he says how far he has billed', () => {
  const m = (billedThrough) => rankPlays({ money: { unbilled: { count: 100, total: 19000, billedThrough }, overdue: { count: 1, total: 1100, top: [] } } });
  assert(m(null).find((p) => p.key === 'bill-clients').title.startsWith('Check billing'));
  assert(m('2026-10-26')[0].key === 'bill-clients' && m('2026-10-26')[0].title.startsWith('Invoice'));
});

test('the model cannot put words about a person who does not exist into the brief', () => {
  const j = cleanJudgement({ headline: 'h', decisions: [{ decision: 'd', recommend: 'r', why: 'w' }, { decision: '' }], coaching: [{ name: 'Nobody', say: 'x' }, { name: 'roushi', say: 'y' }] }, ['Roushi']);
  equal(j.decisions.length, 1);
  equal(j.coaching.map((c) => c.name), ['roushi']);
  equal(cleanJudgement('nonsense'), null);
});

test('a loss is said as a loss', () => {
  assert(verdictLine({ pnl: { net: -500, prevNet: 100 }, win: { day: 9 }, sales: 1000 }).includes('$500 lost'));
});

suite('general manager — against a real database');

const floorFetch = (floor) => async (url) => {
  const u = String(url);
  if (u.includes('/api/intake/floor')) return floor ? new Response(JSON.stringify(floor), { status: 200 }) : new Response('nope', { status: 503 });
  if (u.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"headline":"Cash is stuck.","decisions":[{"decision":"Collect","recommend":"Ring today","why":"overdue"}]}' }] }), { status: 200 });
  return new Response('', { status: 404 });
};

async function seeded(fn) {
  const env = { ...process.env };
  const { client, done } = await withTestDb();
  process.env.RSOPS_INTAKE_KEY = 'k';
  process.env.ANTHROPIC_API_KEY = 'k';
  delete process.env.RESEND_API_KEY;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try { await fn(client); }
  finally { globalThis.fetch = realFetch; for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); done(); }
}

const FLOOR = {
  workers: [{ name: 'Roushi', email: 'r@x.ca', days: { '2026-11-25': { cleaned: 9 } } }],
  units: Array.from({ length: 5 }, (_, i) => ({ id: `R-${i}`, status: 'repair', since: '2026-11-01T12:00:00Z', arrived: true }))
};

test('a full review runs on real SQL, stores itself, sets targets once, and the scan and the phone read it', async () => {
  await seeded(async (client) => {
    await client.query(`INSERT INTO employees (email, name, hourly_rate) VALUES ('r@x.ca','Roushi',20)`);
    await client.query(`INSERT INTO staff_shifts (employee_id, started_at, ended_at, rate)
      SELECT id, '2026-11-25 14:00Z', '2026-11-25 22:00Z', 20 FROM employees`);
    await client.query(`INSERT INTO invoices (number, name, email, status, total, due_date) VALUES ('INV-1','Late Larry','l@x.ca','open',1200,'2026-11-01')`);
    const now = new Date(`${TODAY}T13:00:00Z`);
    const facts = await gatherFacts({ now, fetchImpl: floorFetch(FLOOR) });
    // Only the sources a test cannot have are allowed to be unread.
    const unread = facts.blind.filter((b) => !/master tracker|workshop Board/i.test(b));
    equal(unread, []);
    equal(facts.money.overdue.total, 1200);
    equal(facts.flow.constraint.key, 'repair');
    equal(facts.people.find((p) => p.name === 'Roushi').floor.cleaned, 9);

    const { snapshot } = await buildReview({ now, facts, fetchImpl: floorFetch(FLOOR) });
    assert(snapshot.judgement.ok && snapshot.plays[0].key === 'collect');
    const html = briefHtml(snapshot);
    assert(html.includes('Money moves') && html.includes('Roushi') && html.includes('bottleneck'), html.slice(0, 200));
    await setTargets(facts, { callTarget: 20 });
    equal((await assignmentsOn(TODAY)).length, snapshot.targets.length);

    const issues = (await scanIssues()).issues;
    assert(issues.some((i) => i.key === 'floor-bottleneck' || i.key === 'review-old'), issues.map((i) => i.key).join());
    const call = await reviewForCall('people');
    assert(call.people.some((p) => p.name === 'Roushi'));
  });
});

test('an unreadable floor is named, and nobody is judged or accused because of it', async () => {
  await seeded(async (client) => {
    await client.query(`INSERT INTO employees (email, name, hourly_rate) VALUES ('r@x.ca','Roushi',20)`);
    for (const d of ['2026-11-23', '2026-11-24', '2026-11-25']) await client.query(
      `INSERT INTO staff_shifts (employee_id, started_at, ended_at, rate) SELECT id, $1, $2, 20 FROM employees`, [`${d} 14:00Z`, `${d} 22:00Z`]);
    const facts = await gatherFacts({ now: new Date(`${TODAY}T13:00:00Z`), fetchImpl: floorFetch(null) });
    assert(facts.blind.some((b) => /refurb floor/.test(b)));
    equal(facts.flow, null);
    equal(facts.people[0].flags, []);
    await judgeEarlier({ ...facts, people: [] });             // creates the table
    await client.query(`INSERT INTO manager_assignments (day, person_name, person_email, metric, target) VALUES ('2026-11-25','Roushi','r@x.ca','cleaned',5)`);
    equal((await judgeEarlier(facts)).length, 0);
  });
});

test('staff are texted only with the switch on, only once clocked in, and only once', async () => {
  await seeded(async (client) => {
    process.env.VERCEL_ENV = 'production';
    await client.query(`INSERT INTO employees (email, name, hourly_rate, phone) VALUES ('r@x.ca','Roushi',20,'4165550100'), ('o@x.ca','Off',20,'4165550101')`);
    await assignmentsOn(TODAY);
    await client.query(`INSERT INTO manager_assignments (day, person_name, person_email, metric, target) VALUES ($1,'Roushi','r@x.ca','cleaned',5), ($1,'Off','o@x.ca','cleaned',5)`, [TODAY]);
    await client.query(`INSERT INTO staff_shifts (employee_id, started_at, rate) SELECT id, '2026-11-26 13:00Z', 20 FROM employees WHERE name = 'Roushi'`);
    const now = new Date(`${TODAY}T15:00:00Z`);
    const sent = [];
    const send = async (m) => { sent.push(m); return { ok: true }; };
    equal((await textTargets({ now, send })).skipped, 'texting staff is switched off');
    await saveExecConfig({ textStaff: true });
    equal((await textTargets({ now, send })).sent, ['Roushi']);
    equal((await textTargets({ now, send })).sent, []);
    equal(sent.length, 1);
    equal((await textTargets({ now: new Date(`${TODAY}T03:00:00Z`), send })).skipped, 'outside texting hours');
  });
});

test('the morning brief goes once a day, and a failed send gives the day back', async () => {
  await seeded(async () => {
    process.env.VERCEL_ENV = 'production';
    const now = new Date(`${TODAY}T12:30:00Z`);            // 7:30am Toronto
    const f = floorFetch(FLOOR);
    let threw = false;
    try { await runExecPass({ now, fetchImpl: f }); } catch { threw = true; }
    assert(threw, 'no mail service: the pass fails loudly');
    await saveExecConfig({ emailBrief: false });
    assert((await runExecPass({ now, fetchImpl: f })).brief, 'the day was given back');
    equal((await runExecPass({ now, fetchImpl: f })).brief, undefined);
    equal((await runExecPass({ now: new Date('2026-11-27T10:00:00Z'), fetchImpl: f })).brief, undefined);   // 5am
  });
});

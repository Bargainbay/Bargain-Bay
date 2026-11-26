// Uncalled leads are texted to the sales rep (never the owner), and the owner's end-of-day report says what the rep
// did in both systems. Real lib code on a real Postgres (PGlite); no text is sent and nothing is fetched.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { __useTestDatabase, query } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { saveChaser, getChaser, runLeadChase, chaseSend } from '../lib/lead-chaser.js';
import { repDay, repDayHtml, repNames, isRep } from '../lib/rep-day.js';
import { sendDayReport } from '../lib/manager-report.js';

async function withDb(fn) {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try { await fn(); } finally { globalThis.fetch = realFetch; __useTestDatabase(null); }
}
const REP = 'rep@example.com';
const NOON = new Date('2026-11-25T17:00:00Z');   // 12:00 Toronto
const waiting = async () => ({ workshop: 12, rs: 0, bb: 6, total: 18, oldestHours: 40, workshopError: null });
const seedRep = async () => (await query(`INSERT INTO employees (email, name, phone) VALUES ($1,'John Doe','4165550100') RETURNING id`, [REP])).rows[0].id;
const clockIn = (id, at) => query(`INSERT INTO staff_shifts (employee_id, started_at) VALUES ($1,$2)`, [id, at.toISOString()]);
// Stands in for sendStaffText: logs the row the real one logs.
const fakeSend = (sent, at) => async ({ to, body, kind }) => {
  sent.push(body);
  await query(`INSERT INTO staff_texts (kind, sent_by, to_email, body, status, at) VALUES ($1,'x',$2,$3,'sent',$4)`, [kind, to.email, body, at.toISOString()]);
  return { ok: true, status: 'sent' };
};
const chase = (sent, now = NOON) => runLeadChase({ now, uncalled: waiting, send: fakeSend(sent, now) });

suite('lead chaser: the rep is chased, not the owner');
test('nobody set: nothing is texted', async () => {
  await withDb(async () => {
    const sent = [];
    equal((await chase(sent)).skipped, 'nobody set to chase leads'); equal(sent.length, 0);
  });
});
test('only while clocked in, spaced out, and capped per day', async () => {
  await withDb(async () => {
    const id = await seedRep(); await saveChaser({ rep: REP });
    const sent = [];
    equal((await chase(sent)).skipped, 'not clocked in');
    await clockIn(id, new Date(NOON - 3600_000));
    equal((await chase(sent)).sent, true);
    assert(/John, 18 Facebook leads/.test(sent[0]) && /sales\/leads/.test(sent[0]) && /rssolutions\.ca\/admin/.test(sent[0]), sent[0]);
    equal((await chase(sent, new Date(+NOON + 15 * 60_000))).skipped, 'texted recently');
    equal((await chase(sent, new Date(+NOON + 3 * 3600_000))).sent, true);
    equal((await chase(sent, new Date(+NOON + 6 * 3600_000))).sent, true);
    equal((await runLeadChase({ now: new Date(+NOON + 6.9 * 3600_000), uncalled: waiting, send: fakeSend(sent, NOON) })).skipped, 'daily limit reached');
    equal(sent.length, 3);
  });
});
test('never outside texting hours, and a bad email is refused', async () => {
  await withDb(async () => {
    const id = await seedRep(); await saveChaser({ rep: REP });
    const night = new Date('2026-11-26T02:00:00Z');
    await clockIn(id, new Date(night - 3600_000));
    equal((await chase([], night)).skipped, 'outside texting hours');
    let threw = false; try { await saveChaser({ rep: 'john' }); } catch { threw = true; }
    assert(threw); equal((await getChaser()).rep, REP);
  });
});
test('the owner stops hearing about uncalled leads once a rep who can be texted is set', async () => {
  await withDb(async () => {
    const { BUSINESS_CHECKS } = await import('../lib/manager-business.js');
    const check = BUSINESS_CHECKS.find(([k]) => k === 'Meta leads')[1];
    await query(`INSERT INTO leads (side, contact_name, email, source, created_by, created_at) VALUES ('bb','Old','o@x.com','social','meta-leads@system', now() - interval '30 hours')`);
    const has = async () => (await check()).find((i) => i.key === 'biz-meta-leads-uncalled');
    assert(await has(), 'with nobody set the owner is told');
    await saveChaser({ rep: REP });
    assert(!(await has()), 'otherwise it is the rep\'s job');
    await query(`INSERT INTO staff_texts (kind, sent_by, to_email, body, status, reason) VALUES ('lead_chase','x',$1,'b','failed','blocked')`, [REP]);
    assert(await has(), 'a failing text comes back to the owner');
  });
});

test('no mobile on file: the reminder goes by email, and still spaces the next one', async () => {
  await withDb(async () => {
    const { rows: [e] } = await query(`INSERT INTO employees (email, name) VALUES ($1,'John Doe') RETURNING id`, [REP]);
    await saveChaser({ rep: REP }); await clockIn(e.id, new Date(Date.now() - 3600_000));
    await saveChaser({ startHour: 6, endHour: 22 });
    const mails = [];
    const send = (m) => chaseSend(m, { mail: async (x) => { mails.push(x); return { ok: true }; } });
    const noonish = new Date(); noonish.setUTCHours(17, 0, 0, 0);
    await query(`UPDATE staff_shifts SET started_at = $1`, [new Date(+noonish - 3600_000).toISOString()]);
    const r = await runLeadChase({ now: noonish, uncalled: waiting, send });
    equal(r.sent, true); equal(r.via, 'email'); equal(mails[0].to, REP);
    equal((await query(`SELECT status FROM staff_texts WHERE kind = 'lead_chase'`)).rows[0].status, 'sent');
  });
});

suite('rep day: calls and entries from both systems');
test('names on the shared RS admin are matched; blank ones are credited to nobody', () => {
  const names = repNames('John Doe', 'rep@example.com');
  for (const by of ['John', 'john doe', 'JD', 'J.D.']) assert(isRep(by, names), by);
  assert(!isRep('', names) && !isRep('Ravi', names));
});
test('counts both systems, lists what was entered, and heads the owner\'s report', async () => {
  await withDb(async () => {
    await seedRep(); await saveChaser({ rep: REP });
    const { rows: [l] } = await query(`INSERT INTO leads (side, contact_name, email, owner_email, created_by) VALUES ('bb','Ann Buyer','a@x.com',$1,$1) RETURNING id`, [REP]);
    await query(`INSERT INTO lead_activities (lead_id, kind, outcome, notes, by_email) VALUES ($1,'call','conversation','wants a fridge <b>',$2), ($1,'call','no_answer',NULL,$2), ($1,'note',NULL,'sent photos',$2), ($1,'call','conversation','not mine','other@x.com')`, [l.id, REP]);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    process.env.META_LEADS_KEY = 'k'.repeat(20);
    const rs = [
      { time: '2:00 PM', by: 'John', kind: 'spoke', who: 'Sam Student', text: 'coming Saturday' },
      { time: '2:10 PM', by: 'john', kind: 'tried', who: 'Lee Lead', text: '' },
      { time: '2:20 PM', by: 'Ravi', kind: 'spoke', who: 'Other', text: '' },
      { time: '2:30 PM', by: '', kind: 'entry', who: 'Walk In', text: 'Signed up by staff' }
    ];
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, entries: rs }) });
    try {
      const d = await repDay({ email: REP, date, fetchImpl });
      equal(d.calls.total, 4); equal(d.calls.reached, 2); equal(d.calls.noAnswer, 2); equal(d.calls.rs, 2);
      equal(d.rs.others, 1); equal(d.rs.unnamed, 1); equal(d.bb.newLeads.length, 1); equal(d.bb.unread.length, 0);
      const html = repDayHtml(d, { total: 18 });
      assert(/4 calls/.test(html) && /Sam Student/.test(html) && /Ann Buyer/.test(html) && !/not mine/.test(html));
      assert(html.includes('wants a fridge &lt;b&gt;'), 'typed notes are escaped');
      const down = await repDay({ email: REP, date, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
      assert(/Could not read RS Solutions/.test(repDayHtml(down)), 'an unread system is said, never shown as zero');
      globalThis.fetch = fetchImpl;
      const r = await sendDayReport({ dry: true });
      assert(/John Doe today/.test(r.html) && r.rep.calls.total === 4);
    } finally { delete process.env.META_LEADS_KEY; }
  });
});

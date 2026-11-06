// The Voice Manager: when it may ring, what it says, and that a write needs a
// SECOND turn's yes. lib/manager-rules.js is pure; the tool tests run the real
// lib/manager-call.js against a real Postgres (PGlite) with no phone involved.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import {
  rankIssues, applySnoozes, shouldCallNow, inCallHours, openingLine, toE164, MAX_ATTEMPTS_PER_DAY
} from '../lib/manager-rules.js';
import { callToken, callTokenOk, runTool, startManagerCall, managerTarget, getCall } from '../lib/manager-call.js';
import { EXPECTED } from '../lib/health.js';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

// 2026-11-04 15:00 UTC = 10:00 Toronto (EST); 03:00 UTC = 22:00 the night before.
const DAY = new Date('2026-11-04T15:00:00Z');
const NIGHT = new Date('2026-11-04T03:00:00Z');
const high = { key: 'a', severity: 'high', title: 'A', speak: 'a thing', count: 1 };
const med = { key: 'b', severity: 'medium', title: 'B', speak: 'b thing', count: 3 };
const low = { key: 'c', severity: 'low', title: 'C', speak: 'c thing', count: 9 };

suite('manager rules');
test('issues rank urgent first, then bigger counts', () => {
  equal(rankIssues([low, med, high]).map((i) => i.key), ['a', 'b', 'c']);
  equal(rankIssues([{ ...med, key: 'x', count: 1 }, med]).map((i) => i.key), ['b', 'x']);
});
test('a snoozed issue is hidden and counted, and comes back after its time', () => {
  const now = Date.parse('2026-11-04T15:00:00Z');
  const r = applySnoozes([high, med], { a: '2026-11-06T00:00:00Z', b: '2026-11-01T00:00:00Z' }, now);
  equal(r.live.map((i) => i.key), ['b']); equal(r.hidden.map((i) => i.key), ['a']);
});
test('it only rings inside calling hours, Toronto time', () => {
  assert(inCallHours(DAY)); assert(!inCallHours(NIGHT));
  equal(shouldCallNow({ issues: [high], now: NIGHT }).call, false);
});
test('only urgent or worth-your-time issues earn a call', () => {
  equal(shouldCallNow({ issues: [low], now: DAY }).call, false);
  equal(shouldCallNow({ issues: [], now: DAY }).call, false);
  equal(shouldCallNow({ issues: [med], now: DAY }).call, true);
});
test('it stops once he has answered, spaces retries, and gives up after a few', () => {
  const at = (mins) => new Date(DAY.getTime() - mins * 60000).toISOString();
  equal(shouldCallNow({ issues: [high], today: [{ status: 'answered', started_at: at(300) }], now: DAY }).call, false);
  equal(shouldCallNow({ issues: [high], today: [{ status: 'placed', started_at: at(10) }], now: DAY }).call, false);
  equal(shouldCallNow({ issues: [high], today: [{ status: 'placed', started_at: at(200) }], now: DAY }).call, true);
  const many = Array.from({ length: MAX_ATTEMPTS_PER_DAY }, (_, i) => ({ status: 'voicemail', started_at: at(1000 - i) }));
  equal(shouldCallNow({ issues: [high], today: many, now: DAY }).call, false);
});
test('the opening line counts from the scan and leads with the worst', () => {
  const t = openingLine([low, med, high], { hidden: 2 });
  assert(t.includes('3 things') && t.includes('1 urgent') && t.includes('1 worth your time') && t.includes('1 small'));
  assert(t.includes('a thing') && t.includes('2 more are snoozed'));
  assert(openingLine([]).includes('Nothing needs you'));
});
test('phone numbers become E.164, junk becomes null', () => {
  equal(toE164('(647) 643-3035'), '+16476433035'); equal(toE164('1-647-643-3035'), '+16476433035'); equal(toE164('12345'), null);
});
test('the scheduled run is expected by the health email, with room for the overnight gap', () => {
  assert(EXPECTED['manager-call'] >= 16 * 3600_000);
});

suite('manager call');
test('it rings the owner\'s number, and a call token is not transferable', async () => {
  const saved = process.env.MANAGER_CALL_TO; delete process.env.MANAGER_CALL_TO;
  try { equal(await managerTarget(), '+16476433035'); } finally { if (saved) process.env.MANAGER_CALL_TO = saved; }
  assert(callTokenOk(5, callToken(5))); assert(!callTokenOk(6, callToken(5))); assert(!callTokenOk(5, ''));
});
test('it will not ring from a non-production deployment, or without Twilio', async () => {
  const keep = { ...process.env };
  try {
    delete process.env.TWILIO_ACCOUNT_SID;
    equal((await startManagerCall({ scan: { issues: [], hidden: [] } })).ok, false);
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'y', TWILIO_FROM: '+1', ANTHROPIC_API_KEY: 'k', VERCEL_ENV: 'preview' });
    delete process.env.ALLOW_REAL_OUTBOUND;
    const r = await startManagerCall({ scan: { issues: [], hidden: [] } });
    equal(r.ok, false); assert(/preview/.test(r.reason));
  } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
});

async function withDb(fn) {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  try { await fn(client); } finally { __useTestDatabase(null); }   // a leaked test DB makes later suites think a database exists
}
const seed = (client, list) => client.query(`INSERT INTO manager_calls (to_number, issues) VALUES ('+16476433035', $1::jsonb) RETURNING id`, [JSON.stringify({ list, hidden: 0 })]).then((r) => r.rows[0].id);

test('a write only PROPOSES on its first turn and runs on the next turn\'s identical yes', async () => {
  await withDb(async (client) => {
    const id = await seed(client, []);
    const args = { model: 'MEX731CFS2', copy_from: 'ZZZNOPHOTO' };
    const first = await runTool(id, 'set_photo_from_model', args, { turn: 1 });
    assert(first.needs_confirmation && first.read_back.includes('MEX731CFS2'));
    // The model cannot confirm its own proposal in the same turn.
    const same = await runTool(id, 'set_photo_from_model', args, { turn: 1 });
    assert(same.needs_confirmation);
    // A different argument on a later turn is a NEW proposal, not a confirmation.
    const other = await runTool(id, 'set_photo_from_model', { ...args, model: 'OTHER' }, { turn: 2 });
    assert(other.needs_confirmation);
    // Identical arguments, later turn: it runs (and here refuses, because the model to copy from has no photo).
    await runTool(id, 'set_photo_from_model', args, { turn: 2 }).then((r) => { assert(r.needs_confirmation); });
    const ran = await runTool(id, 'set_photo_from_model', args, { turn: 3 });
    assert(!ran.needs_confirmation && /no photo to copy/.test(ran.error), JSON.stringify(ran));
    equal((await getCall(id)).pending, null);
  });
});
test('snooze, notes and issue detail work, and bad keys are refused', async () => {
  await withDb(async (client) => {
    const id = await seed(client, [{ key: 'photos-missing', severity: 'medium', title: 'T', detail: 'D', link: '/admin/photos' }]);
    const d = await runTool(id, 'issue_details', { key: 'photos-missing' }, { turn: 1 });
    equal(d.detail, 'D'); assert(d.link.endsWith('/admin/photos'));
    assert((await runTool(id, 'issue_details', { key: 'nope' }, { turn: 1 })).error);
    assert((await runTool(id, 'snooze_issue', { key: 'photos-missing', days: 99 }, { turn: 1 })).ok);
    const { rows } = await client.query(`SELECT value FROM settings WHERE key = 'manager_snoozes'`);
    const days = (Date.parse(rows[0].value['photos-missing']) - Date.now()) / 86400000;
    assert(days > 29 && days <= 30, 'snooze is capped at 30 days');
    assert((await runTool(id, 'add_note', { text: 'look into the LG ranges' }, { turn: 1 })).ok);
    equal((await client.query('SELECT body FROM manager_notes')).rows[0].body, 'look into the LG ranges');
    assert((await runTool(id, 'end_call', {}, { turn: 1 })).done);
  });
});
test('the agent has no tool that can touch money, orders or customers', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../lib/manager-call.js', import.meta.url), 'utf8');
  const names = [...src.matchAll(/name: '([a-z_]+)',\n\s+description/g)].map((m) => m[1]).sort();
  equal(names, ['add_note', 'cda_status', 'close_stale_stops', 'email_details', 'end_call', 'issue_details', 'request_code_change', 'run_backup_now', 'run_inventory_sync', 'set_photo_from_model', 'snooze_issue', 'stale_stops_preview']);
  assert(!/from '\.\/(invoices|orders|refunds|payments|customers|jobs)'/.test(src.replace(/import \{ scanIssues[^\n]*/, '')));
});

suite('manager scan');
test('the scan finds missing photos and bad prices, and a check that throws becomes an issue', async () => {
  const { scanIssues } = await import('../lib/manager-issues.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });   // the site is "down"
  try {
    await withDb(async (client) => {
      await client.query(`INSERT INTO products (sku, make, model, category, title, price, compare_at, active)
        VALUES ('T-1','Acme','NOPHOTO-1','Washer','Acme NOPHOTO-1', 0, 500, true),
               ('T-2','Acme','NOPHOTO-1','Washer','Acme NOPHOTO-1', 900, 500, true)`);
      const { issues } = await scanIssues();
      const keys = issues.map((i) => i.key);
      assert(keys.includes('photos-missing'), keys.join());
      assert(keys.includes('price-zero') && keys.includes('price-above-retail'));
      assert(keys.includes('site-shop-down') && keys.includes('site-feed-down'));
      equal(issues[0].severity, 'high');          // ranked: urgent first
      const photos = issues.find((i) => i.key === 'photos-missing');
      assert(photos.title.includes('1 model') && photos.title.includes('2 units'));
      // A broken check is reported, never silently dropped.
      await client.query('DROP TABLE users CASCADE');
      const after = await scanIssues();
      assert(after.issues.some((i) => i.key === 'scan-applications'), after.issues.map((i) => i.key).join());
    });
  } finally { globalThis.fetch = realFetch; }
});

suite('manager fixes');
test('which stale stops are closed, cancelled or left alone', async () => {
  const { decideStop } = await import('../lib/manager-fixes.js');
  const base = { reported: 0, balanceDue: 0, hasSignature: false, photoCount: 0, timeIn: null };
  equal(decideStop(base, 'auto').act, 'cancel');
  equal(decideStop({ ...base, hasSignature: true }, 'auto').act, 'done');
  equal(decideStop({ ...base, timeIn: 'x' }, 'auto').act, 'done');
  equal(decideStop({ ...base, hasSignature: true }, 'cancel_all').act, 'cancel');
  equal(decideStop({ ...base, reported: 50, hasSignature: true }, 'cancel_all').act, 'skip');
  equal(decideStop({ ...base, balanceDue: 10 }, 'auto').act, 'skip');
});
test('closing stale stops needs a yes, closes the safe ones, and leaves money alone', async () => {
  await withDb(async (client) => {
    const { ensureJobSchema } = await import('../lib/jobs.js');
    await ensureJobSchema();
    await client.query(`INSERT INTO jobs (job_number, type, status, job_date, customer_name, address, signature_path)
      VALUES ('RS-T1','delivery','scheduled','2020-01-01','No trace','1 St',NULL),
             ('RS-T2','delivery','on_the_way','2020-01-02','Signed','2 St','sig/x.png'),
             ('RS-T3','delivery','scheduled','2020-01-03','Money','3 St',NULL),
             ('RS-T4','delivery','scheduled','2999-01-01','Future','4 St',NULL)`);
    const t3 = (await client.query("SELECT id FROM jobs WHERE job_number='RS-T3'")).rows[0].id;
    await client.query("INSERT INTO job_collections (job_id, amount, method, status) VALUES ($1, 100, 'cash', 'pending')", [t3]);
    const call = await startManagerCall({ trigger: 'manual', scan: { issues: [], hidden: 0 } }).catch(() => null);
    const id = call?.callId || (await client.query("INSERT INTO manager_calls (to_number, trigger, status, issues) VALUES ('x','manual','ringing','{}') RETURNING id")).rows[0].id;
    const first = await runTool(id, 'close_stale_stops', {}, { turn: 1 });
    assert(first.needs_confirmation, 'proposed, not run');
    equal((await client.query("SELECT count(*)::int n FROM jobs WHERE status='scheduled' OR status='on_the_way'")).rows[0].n, 4);
    const second = await runTool(id, 'close_stale_stops', {}, { turn: 2 });
    assert(second.ok, JSON.stringify(second));
    const st = Object.fromEntries((await client.query('SELECT job_number, status FROM jobs')).rows.map((r) => [r.job_number, r.status]));
    equal(st['RS-T1'], 'cancelled'); equal(st['RS-T2'], 'done');
    equal(st['RS-T3'], 'scheduled'); equal(st['RS-T4'], 'scheduled');   // owed money / not yet due: untouched
  });
});
test('a failing backup is explained, not blank', async () => {
  const { summariseBackupFailure } = await import('../lib/offsite-backup.js');
  assert(summariseBackupFailure({ ok: false, tracker: { error: 'Service Accounts do not have storage quota' }, blobs: { failed: 2, errors: ['a: boom'] } }).includes('storage quota'));
  assert(summariseBackupFailure({ ok: false }).length > 0);
});

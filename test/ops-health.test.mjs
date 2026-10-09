// lib/health.js evaluateHealth, lib/heartbeat.js, lib/offsite-backup.js helpers.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { evaluateHealth, EXPECTED } from '../lib/health.js';
import { newBlobs, flatName } from '../lib/offsite-backup.js';
import { recordHeartbeat, withHeartbeat } from '../lib/heartbeat.js';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();
const env = { SENTRY_DSN: 'x', CRON_SECRET: 'x', RESEND_API_KEY: 'x', BACKUP_DRIVE_FOLDER_ID: 'f' };
const allFresh = () => Object.keys(EXPECTED).map((name) => ({ name, runs: 5, last_ok_at: ago(0.5), last_status: 200, last_error: null }));

suite('ops health');
test('everything fresh and configured is all clear', () => {
  const r = evaluateHealth({ now: NOW, heartbeats: allFresh(), env, offsite: { copied: 3 } });
  equal(r.bad, []); assert(r.ok);
});
test('a job past its allowance is a problem, and says how long', () => {
  const hb = allFresh().map((h) => h.name === 'cda' ? { ...h, last_ok_at: ago(30), last_status: 500, last_error: 'MS_CLIENT_SECRET missing' } : h);
  const r = evaluateHealth({ now: NOW, heartbeats: hb, env, offsite: { copied: 3 } });
  equal(r.bad.length, 1); assert(r.bad[0].includes('cda') && r.bad[0].includes('30h') && r.bad[0].includes('MS_CLIENT_SECRET'));
});
test('a job that has never succeeded is a problem', () => {
  const hb = allFresh().map((h) => h.name === 'tracker' ? { ...h, last_ok_at: null, last_status: 500, runs: 12 } : h);
  assert(evaluateHealth({ now: NOW, heartbeats: hb, env, offsite: { copied: 1 } }).bad.some((m) => m.includes('never succeeded')));
});
test('a job with no heartbeat yet is only a note, not an alarm', () => {
  const r = evaluateHealth({ now: NOW, heartbeats: allFresh().slice(1), env, offsite: { copied: 1 } });
  equal(r.bad, []); equal(r.warn.length, 1);
});
test('missing backup folder, Sentry and Resend are all flagged', () => {
  const r = evaluateHealth({ now: NOW, heartbeats: allFresh(), env: {} });
  assert(r.bad.some((m) => m.includes('BACKUP_DRIVE_FOLDER_ID')) && r.bad.some((m) => m.includes('SENTRY_DSN')) && r.bad.some((m) => m.includes('RESEND_API_KEY')));
});
test('MS_CLIENT_ID without its secret is flagged', () => {
  assert(evaluateHealth({ now: NOW, heartbeats: allFresh(), env: { ...env, MS_CLIENT_ID: 'a' }, offsite: { copied: 1 } }).bad.some((m) => m.includes('MS_CLIENT_SECRET')));
});

suite('off-site backup helpers');
test('only blobs not yet recorded are new, and a re-uploaded name counts again', () => {
  const t1 = '2026-10-01T00:00:00.000Z', t2 = '2026-10-05T00:00:00.000Z';
  const blobs = [{ pathname: 'pod/a.png', uploadedAt: new Date(t1) }, { pathname: 'pod/a.png', uploadedAt: new Date(t2) }, { pathname: 'pod/b.png', uploadedAt: new Date(t1) }];
  const done = [{ pathname: 'pod/a.png', uploaded_at: new Date(t1) }];
  equal(newBlobs(blobs, done).map((b) => `${b.pathname}@${b.uploadedAt.toISOString().slice(0, 10)}`), ['pod/a.png@2026-10-05', 'pod/b.png@2026-10-01']);
});
test('drive names are flat and unique per version', () => {
  equal(flatName('pod/sig/12.png', '2026-10-01T00:00:00Z'), '1790812800__pod__sig__12.png');
});

suite('heartbeat');
test('records success, failure and ignores a 401', async () => {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  try {
  const mk = (status, body) => withHeartbeat('t', async () => new Response(JSON.stringify(body || {}), { status }));
  await mk(200)(); await mk(500, { error: 'boom' })(); await mk(401)();
  const { rows } = await client.query('SELECT * FROM cron_heartbeats WHERE name = $1', ['t']);
  equal(rows.length, 1); equal(Number(rows[0].runs), 2); equal(rows[0].last_status, 500); equal(rows[0].last_error, 'boom'); assert(rows[0].last_ok_at);
  } finally { __useTestDatabase(null); }   // a leaked test DB makes later suites think a database exists
});

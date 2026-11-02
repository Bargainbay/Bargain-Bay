// lib/agent-floor.js: the state a minion shows has to follow what the job actually did.
import { suite, test, equal, assert } from './_harness.mjs';
import { agentState, ROSTER, WORKING_MS } from '../lib/agent-floor.js';
import { EXPECTED } from '../lib/health.js';

const NOW = Date.parse('2026-11-02T15:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600_000;
const cron = (beat) => ({ id: beat, kind: 'cron', beat });
const hb = (o = {}) => ({ last_run_at: ago(10 * 60_000), last_ok_at: ago(10 * 60_000), last_status: 200, runs: 5, ...o });

suite('agent floor states');
test('a job that ran a moment ago is working', () => {
  equal(agentState({ now: NOW, agent: cron('cda'), hb: hb({ last_run_at: ago(60_000), last_ok_at: ago(60_000) }) }), 'working');
});
test('a job that ran on schedule and is quiet is asleep', () => {
  equal(agentState({ now: NOW, agent: cron('cda'), hb: hb() }), 'asleep');
});
test('past its allowance is late, using the health email\'s own allowance', () => {
  const stale = ago(EXPECTED.cda + H);
  equal(agentState({ now: NOW, agent: cron('cda'), hb: hb({ last_ok_at: stale, last_run_at: stale }) }), 'late');
});
test('a run that failed after an earlier success is a warning, not late', () => {
  equal(agentState({ now: NOW, agent: cron('cda'), hb: hb({ last_status: 500, last_run_at: ago(5 * 60_000) }) }), 'warning');
});
test('a job that has run and never succeeded is failing', () => {
  equal(agentState({ now: NOW, agent: cron('tracker'), hb: hb({ last_ok_at: null, last_status: 500 }) }), 'failing');
});
test('a job with no heartbeat row is unknown, never healthy', () => {
  equal(agentState({ now: NOW, agent: cron('tracker'), hb: null }), 'unknown');
});
test('an on-demand assistant is awake only while a message is fresh', () => {
  const a = { kind: 'activity' };
  equal(agentState({ now: NOW, agent: a, activityAt: ago(WORKING_MS - 1000) }), 'working');
  equal(agentState({ now: NOW, agent: a, activityAt: ago(2 * H) }), 'asleep');
  equal(agentState({ now: NOW, agent: a, activityAt: null }), 'unknown');
});
test('systems we cannot see are unknown, and a paused agent is paused', () => {
  equal(agentState({ now: NOW, agent: { kind: 'external' } }), 'unknown');
  equal(agentState({ now: NOW, agent: { kind: 'paused' }, hb: hb() }), 'paused');
});
test('every cron on the roster has a heartbeat name, and ids are unique', () => {
  ROSTER.filter((a) => a.kind === 'cron').forEach((a) => assert(a.beat, `${a.id} has no beat`));
  equal(new Set(ROSTER.map((a) => a.id)).size, ROSTER.length);
});

import { levelFor, cleanStreak, minionXp, castleXp } from '../lib/agent-levels.js';
import { wakeProblem, WAKEABLE } from '../lib/agent-floor.js';
import { wakeIds } from '../lib/agent-wake.js';

suite('agent village levels');
test('levels get steadily more expensive and never stop', () => {
  equal(levelFor(0, 100).level, 1);
  equal(levelFor(99, 100).level, 1);
  equal(levelFor(100, 100).level, 2);
  equal(levelFor(300, 100).level, 3);
  equal(levelFor(600, 100).level, 4);
  equal(levelFor(1_000_000, 100).level > 100, true);
});
test('progress inside a level is reported as a percentage', () => {
  const l = levelFor(200, 100); // level 2 spans 100..300
  equal([l.level, l.into, l.need, l.pct], [2, 100, 200, 50]);
});
test('a clean streak counts days since the last failure, so weekly jobs keep theirs', () => {
  const rows = [{ day: '2026-10-20', runs: 1, fails: 0 }, { day: '2026-10-27', runs: 1, fails: 0 }];
  equal(cleanStreak(rows, '2026-11-02'), 14);
  equal(cleanStreak([...rows, { day: '2026-11-01', runs: 2, fails: 1 }], '2026-11-02'), 1);
  equal(cleanStreak([...rows, { day: '2026-11-02', runs: 1, fails: 1 }], '2026-11-02'), 0);
  equal(cleanStreak([], '2026-11-02'), 0);
});
test('minion XP is successes and clean days, with run count standing in until there is history', () => {
  const rows = [{ day: '2026-11-01', runs: 4, fails: 1 }, { day: '2026-11-02', runs: 2, fails: 0 }];
  equal(minionXp({ rows, todayIso: '2026-11-02' }), (6 - 1) * 10 + 1 * 5);
  equal(minionXp({ rows: [], lifetimeRuns: 7, todayIso: '2026-11-02' }), 70);
});
test('the castle levels from business results, weighted', () => {
  equal(castleXp({ sales: 3, deliveries: 2, paid: 1, chats: 10 }), 30 + 20 + 10 + 10);
  equal(castleXp({}), 0);
});

suite('waking a minion');
test('only the safe jobs can be woken, and not twice in a minute', () => {
  equal(wakeProblem({ id: 'shift-nudge' }) !== null, true);     // texts drivers
  equal(wakeProblem({ id: 'daily-report' }) !== null, true);    // emails the owner
  equal(wakeProblem({ id: 'vendor-orders' }) !== null, true);   // strikes sellers
  equal(wakeProblem({ id: 'cda', lastRunAt: new Date(NOW - 10_000).toISOString(), now: NOW }) !== null, true);
  equal(wakeProblem({ id: 'cda', lastRunAt: new Date(NOW - 5 * 60_000).toISOString(), now: NOW }), null);
});
test('every wakeable job has a loader and every loader is wakeable', () => {
  equal([...WAKEABLE].sort(), wakeIds().sort());
});

import { PGlite } from '@electric-sql/pglite';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { loadAgentFloor } from '../lib/agent-floor.js';

suite('agent village against a real database');
test('heartbeats feed the daily tally, and the loader turns them into levels and states', async () => {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  try {
    const mk = (status) => withHeartbeat('cda', async () => new Response('{}', { status }));
    await mk(200)(); await mk(200)(); await mk(500)();
    const { rows } = await client.query(`SELECT runs, fails FROM cron_daily WHERE name = 'cda'`);
    equal([Number(rows[0].runs), Number(rows[0].fails)], [3, 1]);
    const f = await loadAgentFloor();
    const cda = f.agents.find((a) => a.id === 'cda');
    equal(cda.state, 'warning');                       // the latest run failed, so a failure shows over "just ran"
    equal(cda.canWake, true);
    assert(cda.xp > 0 && cda.level >= 1);
    equal(f.zones.length, 4);
    assert(f.zones.every((z) => z.level >= 1 && z.stat && z.stat.n === 0));
    assert(f.castle.level >= 1);
  } finally { __useTestDatabase(null); }
});

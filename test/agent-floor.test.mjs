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

// The Agent Floor: every scheduled job and assistant, with a state read from what
// it actually did.
//
// WHERE THE STATE COMES FROM, so nobody has to wonder whether the picture lies:
//   - A scheduled job: `cron_heartbeats` (lib/heartbeat.js), the same table the
//     daily health email reads, judged against the SAME allowances
//     (`EXPECTED` in lib/health.js). The floor and the email cannot disagree.
//   - Sarah and RS Manager: the time of their latest stored message. They run on
//     demand, so there is no schedule to be late for: they are awake when a
//     message was written in the last few minutes, asleep otherwise.
//   - Christina (ElevenLabs) and the import-review caller (Twilio): they live in
//     other people's systems and leave no row here. They are shown as UNKNOWN,
//     never as healthy.
//   - Angela is paused on purpose (call forwarding was switched off 2026-10-28).
//
// The state function is pure and exported so a test can pin it.
import { query, hasDb } from './db';
import { EXPECTED } from './health';

const H = 3600_000;
export const WORKING_MS = 3 * 60_000;   // ran this recently = awake and busy
const DEFAULT_ALLOWANCE = 26 * H;

export const ZONES = [
  { key: 'voice', name: 'Call tower', blurb: 'Phones and assistants' },
  { key: 'fleet', name: 'Garage', blurb: 'Dispatch and vans' },
  { key: 'store', name: 'Market', blurb: 'Stock and the storefront' },
  { key: 'back', name: 'Treasury', blurb: 'Reports, ads and backups' }
];

// kind: cron (judged by its heartbeat), activity (judged by latest message),
// external (cannot be seen from here), paused (switched off by decision).
export const ROSTER = [
  { id: 'sarah', name: 'Sarah', zone: 'voice', kind: 'activity', what: 'Takes Bargain Bay phone orders and email on the owner’s behalf.', when: 'On demand' },
  { id: 'christina', name: 'Christina', zone: 'voice', kind: 'external', what: 'Bargain Bay’s voice line, (647) 943-7714. Runs in ElevenLabs, so it leaves no record here.', when: 'Always on' },
  { id: 'angela', name: 'Angela', zone: 'voice', kind: 'paused', what: 'RS Solutions receptionist. Call forwarding to her was switched off on 2026-10-28.', when: 'Paused' },
  { id: 'rs-manager', name: 'RS Manager', zone: 'voice', kind: 'activity', what: 'Crew assistant for drivers, warehouse and sales, in any language.', when: 'On demand' },
  { id: 'import-caller', name: 'Import caller', zone: 'voice', kind: 'external', what: 'Rings the owner to review a client’s delivery sheet. Runs through Twilio.', when: 'When a sheet is staged' },

  { id: 'freightcom', name: 'Freightcom watcher', zone: 'fleet', kind: 'cron', beat: 'freightcom', what: 'Reads Freightcom pickup notices and stages the stops for approval.', when: 'Every 15 min, 6am–10pm UTC' },
  { id: 'cda', name: 'CDA watcher', zone: 'fleet', kind: 'cron', beat: 'cda', what: 'Checks the Canadian Discount Appliances workbook for new rows.', when: 'Every 3 hours' },
  { id: 'tracker', name: 'Van tracker', zone: 'fleet', kind: 'cron', beat: 'tracker', what: 'Pulls the truck’s GPS trail and flags silence.', when: 'Every 20 min, 6am–10pm UTC' },
  { id: 'shift-nudge', name: 'Shift nudger', zone: 'fleet', kind: 'cron', beat: 'shift-nudge', what: 'Reminds drivers and staff who forgot to clock out.', when: 'Twice a day' },
  { id: 'presence', name: 'Presence check', zone: 'fleet', kind: 'cron', beat: 'presence', what: 'Checks who is on shift.', when: 'Every 10 min overnight UTC' },

  { id: 'sync-inventory', name: 'Inventory sync', zone: 'store', kind: 'cron', beat: 'sync-inventory', what: 'Copies the master tracker into the storefront.', when: 'Daily' },
  { id: 'expire-reservations', name: 'Reservation sweeper', zone: 'store', kind: 'cron', beat: 'expire-reservations', what: 'Releases held units when a checkout is abandoned.', when: 'Daily' },
  { id: 'sale-integrity', name: 'Sale integrity', zone: 'store', kind: 'cron', beat: 'sale-integrity', what: 'Looks for sales whose stock and money do not agree.', when: 'Every 20 min' },
  { id: 'inventory-gaps', name: 'Stock gaps', zone: 'store', kind: 'cron', beat: 'inventory-gaps', what: 'Finds units RS Ops holds that the tracker does not.', when: 'Daily' },
  { id: 'vendor-orders', name: 'Marketplace sweeper', zone: 'store', kind: 'cron', beat: 'vendor-orders', what: 'Chases sellers on accept and ready deadlines.', when: 'Every 30 min' },
  { id: 'vesta', name: 'Vesta feed', zone: 'store', kind: 'cron', beat: 'vesta', what: 'Mirrors Vesta Kitchen’s range into the storefront.', when: 'Daily' },

  { id: 'daily-report', name: 'Daily P&L', zone: 'back', kind: 'cron', beat: 'daily-report', what: 'Emails the day’s profit and loss.', when: 'Nightly' },
  { id: 'weekly-report', name: 'Weekly P&L', zone: 'back', kind: 'cron', beat: 'weekly-report', what: 'Emails the week’s profit and loss.', when: 'Mondays' },
  { id: 'health', name: 'Health check', zone: 'back', kind: 'cron', beat: 'health', what: 'Emails whether every scheduled job actually ran.', when: 'Daily' },
  { id: 'backup-offsite', name: 'Off-site backup', zone: 'back', kind: 'cron', beat: 'backup-offsite', what: 'Copies the tracker and new photos to Drive.', when: 'Hourly' },
  { id: 'sync-ads', name: 'Ad spend sync', zone: 'back', kind: 'cron', beat: 'sync-ads', what: 'Pulls yesterday’s ad spend.', when: 'Daily' },
  { id: 'affiliate-payouts', name: 'Payout run', zone: 'back', kind: 'cron', beat: 'affiliate-payouts', what: 'Lists affiliates who are owed $50 or more.', when: 'Mondays' }
];

const ms = (v) => (v ? new Date(v).getTime() : 0);

// Pure. `hb` is a cron_heartbeats row (or null); `activityAt` the latest message time.
//   working   ran in the last few minutes
//   asleep    healthy and quiet
//   warning   the latest run failed but an earlier one succeeded inside its allowance
//   late      no success within its allowance
//   failing   has run and never once succeeded
//   unknown   nothing here can see it
//   paused    switched off on purpose
export function agentState({ now = Date.now(), agent, hb = null, activityAt = null }) {
  if (agent.kind === 'paused') return 'paused';
  if (agent.kind === 'external') return 'unknown';
  if (agent.kind === 'activity') {
    if (!activityAt) return 'unknown';
    return now - ms(activityAt) <= WORKING_MS ? 'working' : 'asleep';
  }
  if (!hb) return 'unknown';
  const ok = ms(hb.last_ok_at);
  if (!ok) return 'failing';
  const allowance = EXPECTED[agent.beat] || DEFAULT_ALLOWANCE;
  if (now - ok > allowance) return 'late';
  if (Number(hb.last_status) >= 400) return 'warning';
  return now - ms(hb.last_run_at) <= WORKING_MS ? 'working' : 'asleep';
}

export const NEEDS_ATTENTION = new Set(['warning', 'late', 'failing']);

export async function loadAgentFloor(now = Date.now()) {
  let beats = {}; let dbOk = hasDb();
  if (dbOk) {
    try { for (const r of (await query('SELECT * FROM cron_heartbeats')).rows) beats[r.name] = r; }
    catch { dbOk = false; }
  }
  const latest = async (sql) => { try { return (await query(sql)).rows[0]?.t || null; } catch { return null; } };
  const [sarahAt, managerAt] = dbOk
    ? await Promise.all([
        latest('SELECT max(created_at) AS t FROM sarah_messages'),
        latest('SELECT max(at) AS t FROM assistant_messages')
      ])
    : [null, null];
  const activity = { sarah: sarahAt, 'rs-manager': managerAt };

  const agents = ROSTER.map((a) => {
    const hb = a.beat ? beats[a.beat] || null : null;
    const activityAt = activity[a.id] || null;
    const lastRunAt = hb?.last_run_at || activityAt || null;
    return {
      id: a.id, name: a.name, zone: a.zone, kind: a.kind, what: a.what, when: a.when,
      state: agentState({ now, agent: a, hb, activityAt }),
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      lastOkAt: hb?.last_ok_at ? new Date(hb.last_ok_at).toISOString() : null,
      runs: hb ? Number(hb.runs) : null,
      error: hb?.last_error || null
    };
  });

  const counts = { working: 0, asleep: 0, attention: 0, unknown: 0, paused: 0 };
  for (const a of agents) {
    if (a.state === 'working') counts.working++;
    else if (a.state === 'asleep') counts.asleep++;
    else if (NEEDS_ATTENTION.has(a.state)) counts.attention++;
    else if (a.state === 'paused') counts.paused++;
    else counts.unknown++;
  }
  return { asOf: new Date(now).toISOString(), dbOk, zones: ZONES, agents, counts };
}

// The daily "is the business plumbing alive" email.
//
// The pattern this exists to end: a scheduled job fails the same way on every run
// and the only trace is a log line nobody reads (CDA watcher, QuickBooks sandbox,
// the tracker sync dropping 61 units). Error alerts (lib/observe.js) catch a
// THROWN error. They cannot catch a job that stopped running, or one that is
// configured wrong and returns quietly — that needs a heartbeat to compare to.
//
// Sent EVERY day, all-clear included. An email that only arrives when something
// is wrong cannot tell you the checker itself died; one that arrives daily can.
import { query, hasDb } from './db';
import { sendEmail } from './email';
import { SERVICE_EMAIL } from './constants';
import { offsiteStatus, offsiteConfigured } from './offsite-backup';
import { isProduction } from './environment';

const H = 3600_000;
// How long each scheduled job may go without a successful run before it is a
// problem. Jobs with an hour window in vercel.json (06-22 UTC) get 9h so the
// overnight gap is not a false alarm.
export const EXPECTED = {
  'expire-reservations': 26 * H,
  'sync-inventory': 26 * H,
  'sync-ads': 26 * H,
  'inventory-gaps': 26 * H,
  'shift-nudge': 26 * H,
  'presence': 26 * H,
  'freightcom': 9 * H,
  'tracker': 9 * H,
  'cda': 4 * H,
  'vendor-orders': 2 * H,
  'backup-offsite': 3 * H
};

// Pure: heartbeats + environment in, a list of findings out. Tested directly.
export function evaluateHealth({ now = Date.now(), heartbeats = [], env = {}, offsite = null }) {
  const bad = [];   // needs action
  const warn = [];  // worth knowing
  const by = Object.fromEntries(heartbeats.map((h) => [h.name, h]));

  for (const [name, maxAge] of Object.entries(EXPECTED)) {
    if (name === 'backup-offsite' && !env.BACKUP_DRIVE_FOLDER_ID) continue; // reported below
    const h = by[name];
    if (!h) { warn.push(`${name}: no run recorded yet`); continue; }
    const ok = h.last_ok_at ? new Date(h.last_ok_at).getTime() : 0;
    const age = now - ok;
    if (!ok) bad.push(`${name}: has run ${h.runs}x and never succeeded${h.last_error ? ` (${h.last_error})` : ''}`);
    else if (age > maxAge) bad.push(`${name}: last success ${Math.round(age / H)}h ago${h.last_error ? ` — latest failure: ${h.last_error}` : ''}`);
    else if (h.last_status >= 400) warn.push(`${name}: latest run failed (${h.last_error || h.last_status}), succeeded ${Math.round(age / H)}h ago`);
  }

  if (!env.SENTRY_DSN) bad.push('SENTRY_DSN is not set: errors are not being reported anywhere');
  if (!env.CRON_SECRET) bad.push('CRON_SECRET is not set: scheduled jobs are refused in production');
  if (!env.RESEND_API_KEY) bad.push('RESEND_API_KEY is not set: no email can be sent');
  if (env.MS_CLIENT_ID && !env.MS_CLIENT_SECRET) bad.push('MS_CLIENT_ID is set but MS_CLIENT_SECRET is not: the CDA watcher cannot read the workbook');
  if (!env.BACKUP_DRIVE_FOLDER_ID) bad.push('BACKUP_DRIVE_FOLDER_ID is not set: the tracker and Blob files (signatures, photos) have NO off-site backup');
  else if (offsite && offsite.copied === 0) warn.push('Off-site backup is configured but no Blob file has been copied yet');

  return { bad, warn, ok: bad.length === 0 };
}

const li = (items) => items.map((t) => `<li>${t.replace(/</g, '&lt;')}</li>`).join('');

export async function runHealth({ email = true } = {}) {
  if (!hasDb()) return { ok: false, error: 'no database' };
  let heartbeats = [];
  try { heartbeats = (await query('SELECT * FROM cron_heartbeats')).rows; } catch { /* not migrated */ }
  const offsite = offsiteConfigured() ? await offsiteStatus() : null;
  const res = evaluateHealth({ heartbeats, env: process.env, offsite });
  if (email && isProduction()) {
    const subject = res.ok ? `Health: all clear${res.warn.length ? ` (${res.warn.length} to note)` : ''}` : `Health: ${res.bad.length} problem${res.bad.length === 1 ? '' : 's'}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
      ${res.bad.length ? `<h3 style="color:#b3261e;margin:0 0 6px">Needs attention</h3><ul>${li(res.bad)}</ul>` : '<p><b>Everything scheduled is running.</b></p>'}
      ${res.warn.length ? `<h3 style="margin:14px 0 6px">Worth knowing</h3><ul>${li(res.warn)}</ul>` : ''}
      <p style="color:#666;font-size:12px">Daily check of scheduled jobs, error reporting and off-site backups. No email from this at all means the checker itself is down.</p></div>`;
    res.sent = await sendEmail({ to: SERVICE_EMAIL, subject, html }).catch(() => false);
  }
  return res;
}

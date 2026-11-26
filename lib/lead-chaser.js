// Uncalled Facebook leads are the sales rep's to chase, not the owner's (owner, 2026-11-25).
//
// The Manager texts the rep (emails them if there is no mobile on file) while the rep is CLOCKED IN, between the start and end hour, no sooner than `gapHours`
// after the last one and at most `perDay` a day. The owner hears about uncalled leads only in the end-of-day report
// (lib/rep-day.js), or if the text cannot be sent. Who is chased is a setting (`lead_chaser`), never hard-coded:
// this repo is public. With nobody set, the owner is told as before.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';
import { staleMetaLeads, workshopWaiting } from './meta-leads';
import { staffByEmail, sendStaffText } from './staff-texts';
import { sendEmail } from './email';
import { SITE_URL } from './site';

export const CHASER_KEY = 'lead_chaser';
const KIND = 'lead_chase';
const BY = 'Sales Manager (AI)';
const MAX_SHIFT_MS = 16 * 3600_000;
const norm = (e) => String(e || '').trim().toLowerCase();
const int = (v, d, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };

export function normalizeChaser(i = {}) {
  const rep = norm(i.rep);
  return {
    rep: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rep) ? rep : '',
    startHour: int(i.startHour, 10, 6, 20), endHour: int(i.endHour, 19, 8, 22),
    gapHours: int(i.gapHours, 3, 1, 12), perDay: int(i.perDay, 3, 1, 6)
  };
}
export async function getChaser() { return normalizeChaser((await getSetting(CHASER_KEY, null)) || {}); }
export async function saveChaser(input) {
  if (String(input?.rep || '').trim() && !normalizeChaser(input).rep) throw new Error('That is not an email address.');
  const cfg = normalizeChaser({ ...(await getChaser()), ...input });
  await setSetting(CHASER_KEY, cfg);
  return cfg;
}

/** Meta leads over 4 hours old that nobody has called, on every board. */
export async function uncalledLeads() {
  const hub = await staleMetaLeads({ hours: 4 });
  let ws = { waiting: 0, oldestHours: 0 }; let workshopError = null;
  try { ws = (await workshopWaiting()) || ws; } catch (e) { workshopError = String(e?.message || e); }
  const workshop = ws.waiting || 0;
  return { workshop, rs: hub.hubRs, bb: hub.hubBb, total: workshop + hub.hubRs + hub.hubBb, oldestHours: Math.max(hub.oldestHours, ws.oldestHours || 0), workshopError };
}

export function chaseText(name, u) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'Hi';
  const where = [];
  if (u.workshop) where.push(`${u.workshop} workshop: rssolutions.ca/admin (Workshop, Board)`);
  if (u.rs + u.bb) where.push(`${u.rs + u.bb} sales: ${SITE_URL.replace(/^https?:\/\//, '')}/sales/leads`);
  return `${first}, ${u.total} Facebook lead${u.total === 1 ? ' has' : 's have'} not been called (oldest ${u.oldestHours}h). ${where.join('. ')}. Call them and log each call, answered or not.`;
}

const torontoDate = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const torontoHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', hourCycle: 'h23' }).format(d));

async function clockedIn(email, now) {
  const { rows } = await query(
    `SELECT s.started_at FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
      WHERE lower(e.email) = $1 AND s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1`, [email]);
  return !!rows[0] && now - new Date(rows[0].started_at) < MAX_SHIFT_MS;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Text when there is a mobile on file, otherwise email. Either way a staff_texts row is left, which spaces the next one. */
export async function chaseSend({ to, body, kind, nudge, sentBy }, { mail = sendEmail } = {}) {
  if (to.phoneKey) return sendStaffText({ to, body, kind, nudge, sentBy });
  const r = await mail({ to: to.email, subject: 'Facebook leads waiting for your call', html: `<p>${esc(body)}</p>` }).catch((e) => ({ ok: false, error: e?.message }));
  const ok = !!r?.ok;
  const reason = ok ? 'by email (no mobile on file)' : `email did not send${r?.error || r?.reason ? `: ${r.error || r.reason}` : ''}`.slice(0, 300);
  await query(
    `INSERT INTO staff_texts (kind, nudge, sent_by, to_name, to_email, body, status, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [kind, nudge, sentBy, to.name || null, to.email, body, ok ? 'sent' : 'failed', reason]);
  return { ok, status: ok ? 'sent' : 'failed', reason, via: 'email' };
}

/** One pass. `dry` sends and writes nothing. `send` and `uncalled` are test seams. */
export async function runLeadChase({ dry = false, now = new Date(), send = chaseSend, uncalled = uncalledLeads } = {}) {
  if (!hasDb()) return { skipped: 'no database' };
  const cfg = await getChaser();
  if (!cfg.rep) return { skipped: 'nobody set to chase leads' };
  const u = await uncalled();
  if (!u.total) return { skipped: 'nothing waiting', ...u };
  const hour = torontoHour(now);
  if (hour < cfg.startHour || hour >= cfg.endHour) return { skipped: 'outside texting hours', ...u };
  if (!(await clockedIn(cfg.rep, now))) return { skipped: 'not clocked in', ...u };
  const { rows } = await query(
    `SELECT at FROM staff_texts WHERE kind = $1 AND lower(to_email) = $2 AND at > $3::timestamptz - interval '36 hours' ORDER BY at DESC`,
    [KIND, cfg.rep, now.toISOString()]).catch(() => ({ rows: null }));
  if (!rows) return { skipped: 'cannot read the text log', ...u };   // never risk texting every pass
  const today = rows.filter((r) => torontoDate(new Date(r.at)) === torontoDate(now));
  if (today.length >= cfg.perDay) return { skipped: 'daily limit reached', ...u };
  if (rows[0] && now - new Date(rows[0].at) < cfg.gapHours * 3600_000) return { skipped: 'texted recently', ...u };
  const person = await staffByEmail(cfg.rep);
  const to = person || { email: cfg.rep, name: cfg.rep };
  const body = chaseText(to.name, u);
  if (dry) return { dry: true, to: to.name, via: to.phoneKey ? 'text' : 'email', body, ...u };
  const r = await send({ to, body, kind: KIND, nudge: 'uncalled_leads', sentBy: BY });
  return { sent: !!r.ok, status: r.status, reason: r.reason, via: r.via || 'text', to: to.name, ...u };
}

/** How many chase texts reached the rep on one Toronto day. */
export async function chasesOn(email, date) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM staff_texts WHERE kind = $1 AND lower(to_email) = $2 AND status = 'sent' AND (at AT TIME ZONE 'America/Toronto')::date = $3::date`,
    [KIND, norm(email), date]).catch(() => ({ rows: [] }));
  return rows[0]?.n || 0;
}

/** Why the rep is NOT being reached, or null. The owner is told only then. */
export async function chaseProblem(cfg) {
  const { rows } = await query(
    `SELECT status, reason FROM staff_texts WHERE kind = $1 AND lower(to_email) = $2 AND at > now() - interval '36 hours' ORDER BY at DESC, id DESC LIMIT 1`,
    [KIND, cfg.rep]).catch(() => ({ rows: [] }));
  return rows[0] && rows[0].status !== 'sent' ? (rows[0].reason || rows[0].status) : null;
}

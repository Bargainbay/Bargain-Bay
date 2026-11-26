// How the sales rep did on one Toronto day, for the owner's end-of-day report: calls and everything they entered in
// the Bargain Bay sales portal and in the RS Solutions admin.
//
// RS Solutions admin has ONE shared password, so an entry there is the rep's only when it carries their typed name.
// Entries with no name (card moves made before names were recorded, sign-ups, payments) are counted separately and
// never credited to anybody. A source that cannot be read is SAID to be unread, never shown as zero.
import { query, hasDb } from './db';
import { staffByEmail } from './staff-texts';
import { chasesOn } from './lead-chaser';

const rsBase = () => (process.env.RSSOLUTIONS_SITE_URL || 'https://rssolutions.ca').replace(/\/+$/, '');
const norm = (e) => String(e || '').trim().toLowerCase();
const DAY = (col) => `(${col} AT TIME ZONE 'America/Toronto')::date = $2::date`;
const TIME = (col) => `to_char(${col} AT TIME ZONE 'America/Toronto', 'FMHH12:MI am')`;

/** The names a rep may type: full name, first name, last name, initials. */
export function repNames(name, email) {
  const parts = String(name || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set(parts.filter((p) => p.length > 2));
  if (parts.length) out.add(parts.join(' '));
  if (parts.length > 1) out.add(parts.map((p) => p[0]).join(''));
  const local = norm(email).split('@')[0];
  if (local) out.add(local);
  return [...out];
}
export const isRep = (by, names) => {
  const b = String(by || '').trim().toLowerCase().replace(/\./g, '');
  return !!b && (names.includes(b) || names.includes(b.split(/\s+/)[0]));
};

async function rows(sql, params, errors, label) {
  try { return (await query(sql, params)).rows; }
  catch (e) { errors.push(label); console.error(`rep day: ${label} failed`, e?.message || e); return []; }
}

export async function rsActivity(date, fetchImpl = fetch) {
  const key = process.env.META_LEADS_KEY;
  if (!key) return { ok: false, error: 'META_LEADS_KEY is not set' };
  try {
    const res = await fetchImpl(`${rsBase()}/api/ops/activity?date=${encodeURIComponent(date)}`, { headers: { 'x-meta-leads-key': key }, signal: AbortSignal.timeout(25000), cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok || !Array.isArray(j.entries)) return { ok: false, error: `RS Solutions answered ${res.status}` };
    return { ok: true, entries: j.entries };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

export async function repDay({ email, date, fetchImpl = fetch }) {
  if (!hasDb()) return null;
  const me = norm(email);
  const person = await staffByEmail(me);
  const name = person?.name && person.name !== me ? person.name : me;
  const names = repNames(person?.name, me);
  const errors = [];
  const p = [me, date];

  const shifts = await rows(
    `SELECT ${TIME('s.started_at')} AS "from", ${TIME('s.ended_at')} AS "to",
            (extract(epoch FROM (COALESCE(s.ended_at, now()) - s.started_at)) / 3600)::float AS hours
       FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
      WHERE lower(e.email) = $1 AND ${DAY('s.started_at')} ORDER BY s.started_at`, p, errors, 'hours');
  const activity = await rows(
    `SELECT a.kind, a.outcome, a.notes, ${TIME('a.occurred_at')} AS at, COALESCE(l.contact_name, l.company, 'a lead') AS who
       FROM lead_activities a JOIN leads l ON l.id = a.lead_id
      WHERE lower(a.by_email) = $1 AND ${DAY('a.occurred_at')} ORDER BY a.occurred_at, a.id`, p, errors, 'lead activity');
  const newLeads = await rows(
    `SELECT COALESCE(contact_name, company, 'unnamed') AS who FROM leads WHERE lower(created_by) = $1 AND ${DAY('created_at')} ORDER BY id`, p, errors, 'new leads');
  const customerNotes = await rows(
    `SELECT a.kind, a.body AS notes, ${TIME('a.at')} AS at, COALESCE(c.name, c.email, 'a customer') AS who
       FROM customer_activity a JOIN customers c ON c.id = a.customer_id
      WHERE lower(a.by_email) = $1 AND ${DAY('a.created_at')} AND a.kind <> 'system' ORDER BY a.id`, p, errors, 'customer notes');
  const tasks = await rows(
    `SELECT title FROM customer_tasks WHERE lower(created_by) = $1 AND ${DAY('created_at')} ORDER BY id`, p, errors, 'follow-ups');
  const invoices = await rows(
    `SELECT number, name, total::float AS total FROM invoices WHERE lower(created_by) = $1 AND ${DAY('created_at')} AND status <> 'void' ORDER BY id`, p, errors, 'invoices');
  const quotes = await rows(
    `SELECT number, name, total::float AS total FROM quotes WHERE lower(sales_rep) = ANY($1) AND ${DAY('created_at')} ORDER BY id`, [names, date], errors, 'quotes');
  const [list] = await rows(
    `SELECT count(*)::int AS given, count(*) FILTER (WHERE first_touch_at IS NOT NULL)::int AS touched
       FROM leads WHERE lower(owner_email) = $1 AND assigned_by = 'daily-list' AND ${DAY('assigned_at')}`, p, errors, 'daily call list');

  const rsRaw = await rsActivity(date, fetchImpl);
  const rsMine = rsRaw.ok ? rsRaw.entries.filter((e) => isRep(e.by, names)) : [];
  const rsOther = rsRaw.ok ? rsRaw.entries.filter((e) => !isRep(e.by, names)) : [];

  // A call: a call logged in the portal, or "spoke to them" / "tried" on the workshop Board.
  const bbCalls = activity.filter((a) => a.kind === 'call');
  const rsCalls = rsMine.filter((e) => e.kind === 'spoke' || e.kind === 'tried');
  const reached = bbCalls.filter((a) => ['conversation', 'meeting_booked', 'proposal_sent', 'not_interested'].includes(a.outcome)).length
    + rsCalls.filter((e) => e.kind === 'spoke').length;
  const noAnswer = bbCalls.filter((a) => a.outcome === 'no_answer' || a.outcome === 'voicemail').length + rsCalls.filter((e) => e.kind === 'tried').length;

  return {
    name, date, chases: await chasesOn(me, date), shifts, hours: Math.round(shifts.reduce((n, s) => n + (s.hours || 0), 0) * 10) / 10,
    calls: { total: bbCalls.length + rsCalls.length, reached, noAnswer, bb: bbCalls.length, rs: rsCalls.length },
    bb: { activity, newLeads, customerNotes, tasks, invoices, quotes, dailyList: list?.given ? list : null, unread: errors },
    rs: { ok: rsRaw.ok, error: rsRaw.error || null, entries: rsMine, others: rsOther.filter((e) => e.by).length, unnamed: rsOther.filter((e) => !e.by).length }
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const label = (s) => String(s || '').replace(/_/g, ' ');
const money = (n) => `$${Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const list = (items, max = 80) => (items.length
  ? `<ul>${items.slice(0, max).map((i) => `<li>${i}</li>`).join('')}${items.length > max ? `<li>and ${items.length - max} more</li>` : ''}</ul>`
  : '<p style="color:#666;margin:2px 0">Nothing entered.</p>');

/** The email section. `waiting` is uncalledLeads() at send time, or null. */
export function repDayHtml(d, waiting = null) {
  if (!d) return '';
  const shift = d.shifts.length ? `${d.shifts.map((s) => `${s.from} to ${s.to || 'still clocked in'}`).join(', ')} (${d.hours}h)` : 'did not clock in';
  const bb = [
    ...d.bb.activity.map((a) => `${esc(a.at)} ${esc(label(a.kind))} — ${esc(a.who)}${a.outcome ? `: ${esc(label(a.outcome))}` : ''}${a.notes ? ` — ${esc(String(a.notes).slice(0, 300))}` : ''}`),
    ...d.bb.customerNotes.map((a) => `${esc(a.at)} customer ${esc(a.kind)} — ${esc(a.who)}: ${esc(String(a.notes).slice(0, 300))}`),
    ...d.bb.newLeads.map((l) => `New lead added: ${esc(l.who)}`),
    ...d.bb.tasks.map((t) => `Follow-up created: ${esc(t.title)}`),
    ...d.bb.quotes.map((q) => `Quote ${esc(q.number)} — ${esc(q.name)}, ${money(q.total)}`),
    ...d.bb.invoices.map((i) => `Invoice ${esc(i.number)} — ${esc(i.name)}, ${money(i.total)}`)
  ];
  const rs = d.rs.entries.map((e) => `${esc(e.time)} ${esc(e.kind === 'spoke' ? 'spoke to' : e.kind === 'tried' ? 'tried, no answer:' : `${label(e.kind)}:`)} ${esc(e.who)}${e.text ? ` — ${esc(String(e.text).slice(0, 300))}` : ''}`);
  const extra = d.rs.ok && (d.rs.unnamed || d.rs.others)
    ? `<p style="color:#666;font-size:12px;margin:2px 0">Not counted for ${esc(d.name)}: ${d.rs.unnamed} entries with no name on them, ${d.rs.others} under another name.</p>` : '';
  return `<h2 style="margin:16px 0 4px">${esc(d.name)} today</h2>`
    + `<p><b>${d.calls.total} calls</b> (${d.calls.reached} reached, ${d.calls.noAnswer} no answer) — ${d.calls.rs} logged in RS Solutions, ${d.calls.bb} in the sales portal.<br>Hours: ${esc(shift)}.`
    + (d.bb.dailyList ? `<br>Today's call list: ${d.bb.dailyList.touched} of ${d.bb.dailyList.given} contacted.` : '')
    + (waiting ? `<br>Facebook leads still not called: <b>${waiting.total}</b>${waiting.workshopError ? ' (the workshop Board could not be read, so this is short)' : ''}.` : '')
    + (d.chases ? `<br>I reminded ${esc(d.name)} ${d.chases} time${d.chases === 1 ? '' : 's'} about uncalled leads.` : '')
    + `</p><h3 style="margin:10px 0 2px">Bargain Bay sales portal</h3>${list(bb)}`
    + (d.bb.unread.length ? `<p style="color:#b00020">Could not read: ${esc(d.bb.unread.join(', '))}.</p>` : '')
    + `<h3 style="margin:10px 0 2px">RS Solutions admin</h3>${d.rs.ok ? list(rs) : `<p style="color:#b00020">Could not read RS Solutions (${esc(d.rs.error)}).</p>`}${extra}`;
}

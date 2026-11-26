// Telling the owner what was done: one email per task as it finishes, and one report
// at the end of the day with everything (owner, 2026-11-17: "I need to get a
// notification when a task is done. Manager reports to me at the end of the day").
//
// Email only (his choice). Best-effort and never throws into the work it describes:
// a mail hiccup must not undo a payment that was marked paid. In staging
// `sendEmail` redirects or refuses (lib/environment.js), so this never mails a
// real person from a preview.
import { query, hasDb } from './db';
import { sendEmail } from './email';
import { SERVICE_EMAIL } from './constants';
import { SITE_URL } from './site';
import { DEPTS, deptKey, dayReport } from './manager-policy';
import { torontoDay } from './manager-business';
import { ensureActionSchema, markReported } from './manager-actions';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One finished task. Awaited by the caller (a serverless function is frozen the
// moment its response goes out — the same lesson as the dispatch mail).
export async function notifyDone({ summary, dept = 'gm', by = 'on your instruction' } = {}) {
  try {
    const d = DEPTS[deptKey(dept)];
    const r = await sendEmail({
      to: SERVICE_EMAIL,
      subject: `${d.label}: done — ${String(summary).slice(0, 90)}`,
      html: `<p>${esc(summary)}.</p><p style="color:#666;font-size:12px">Done ${esc(by)} by your ${esc(d.label)}. Everything is logged on <a href="${SITE_URL}/admin/manager">the Manager page</a>.</p>`
    });
    return !!(r && r.ok !== false);
  } catch (e) { console.error('manager notify failed', e?.message || e); return false; }
}

// Everything done on a Toronto day, rolled up by department.
export async function actionsOn(date = torontoDay()) {
  if (!hasDb()) return [];
  await ensureActionSchema();
  const { rows } = await query(
    `SELECT id, at, kind, summary, detail, via, reported_at FROM manager_actions
      WHERE (at AT TIME ZONE 'America/Toronto')::date = $1::date AND kind <> 'payment_flag' ORDER BY id`, [date]);
  return rows;
}

export async function buildDayReport(date = torontoDay()) {
  const actions = await actionsOn(date);
  let flagged = []; let calls = 0;
  try { const { reviewList } = await import('./manager-payments'); flagged = (await reviewList()).map((p) => p.note); } catch { /* none */ }
  try {
    const { rows } = await query(`SELECT count(*)::int AS n FROM manager_calls WHERE (started_at AT TIME ZONE 'America/Toronto')::date = $1::date AND status <> 'failed'`, [date]);
    calls = rows[0]?.n || 0;
  } catch { /* no calls table yet */ }
  let issues = [];
  try { const { scanIssues } = await import('./manager-issues'); issues = (await scanIssues()).issues.slice(0, 8); } catch { /* the report does not depend on the scan */ }
  return { date, actions, ...dayReport({ actions, flagged, calls, date }), open: issues.map((i) => i.title) };
}

// How the sales rep did today (lib/rep-day.js). Never lets a failure take the report down, and says when it failed.
export async function repSection(date) {
  try {
    const { getChaser, uncalledLeads } = await import('./lead-chaser');
    const cfg = await getChaser();
    if (!cfg.rep) return { html: '', summary: '' };
    const { repDay, repDayHtml } = await import('./rep-day');
    const waiting = await uncalledLeads().catch(() => null);
    const d = await repDay({ email: cfg.rep, date });
    if (!d) return { html: '', summary: '' };
    return { html: repDayHtml(d, waiting), summary: `${String(d.name).split(' ')[0]}: ${d.calls.total} calls`, rep: d };
  } catch (e) {
    console.error('rep day report failed', e?.message || e);
    return { html: '<p style="color:#b00020">Could not build the sales rep\u2019s day.</p>', summary: '' };
  }
}

export async function sendDayReport({ date = torontoDay(), dry = false } = {}) {
  const r = await buildDayReport(date);
  const rep = await repSection(date);
  const sections = r.sections.map((s) => `<h3 style="margin:14px 0 4px">${esc(s.dept)}</h3><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');
  const needs = r.needsYou.length ? `<h3 style="margin:14px 0 4px;color:#b00020">Needs you</h3><ul>${r.needsYou.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const open = r.open.length ? `<h3 style="margin:14px 0 4px">Still open</h3><ul>${r.open.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px">${rep.html}<p><b>${esc(r.head)}</b></p>${sections}${needs}${open}`
    + `<p style="color:#666;font-size:12px">The General Manager's end-of-day report, rolled up from the Delivery and Sales managers. Full log on <a href="${SITE_URL}/admin/manager">the Manager page</a>.</p></div>`;
  if (dry) return { ok: true, dry: true, ...r, rep: rep.rep || null, html };
  const sent = await sendEmail({ to: SERVICE_EMAIL, subject: `Manager's day: ${rep.summary ? `${rep.summary}, ` : ''}${r.actions.length} done${r.needsYou.length ? `, ${r.needsYou.length} need you` : ''} (${date})`, html })
    .then((x) => !!(x && x.ok !== false)).catch(() => false);
  if (sent && r.actions.length) await markReported(r.actions.map((a) => a.id)).catch(() => {});
  return { ok: sent, ...r };
}

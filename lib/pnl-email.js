// The Daily and Weekly P&L emails: the Daily P&L page's own table, mailed to the office.
//
// It is dailyPnl() and nothing else, so the email, the page and the dispatch Profit tab cannot disagree.
// Net is shown two ways because both get asked for: the page's net (after the cost-list overhead) and
// net before overhead ("excluding other bills"), which is the figure the owner reads the week by.
import { dailyPnl } from './daily-pnl';
import { daysBetween } from './daily-cost-math';
import { torontoToday, round2, SERVICE_EMAIL } from './constants';
import { sendEmail } from './email';
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => {
  const x = Number(v || 0);
  const t = Math.abs(x).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `($${t})` : `$${t}`;
};
const colour = (v) => (Number(v) < 0 ? '#b3261e' : '#1b6e3a');
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

/** Net before the cost-list overhead. Pure. */
export const netBeforeOverhead = (row) => round2((row.net || 0) + (row.overhead || 0));

const addDays = (iso, n) => daysBetween(iso, iso).length && new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

/** { from, to } of the Monday-to-Sunday week that contains `today` (sent Sunday night, so it ends today). Pure. */
export function thisWeek(today = torontoToday()) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();            // 0 = Sunday
  const from = addDays(today, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
}

const COLS = [
  ['Product profit', 'productProfit'], ['Deliveries billed', 'deliveryIncome'], ['Marketplace', 'marketplaceIncome'],
  ['Delivery costs', 'deliveryCost', true], ['Staff wages', 'staffWages', true], ['Overhead', 'overhead', true],
  ['Net', 'net']
];

/** Subject + HTML for a result from dailyPnl(). Pure. */
export function renderReport({ kind, result }) {
  const { rows, totals, warnings, from, to } = result;
  const t = { ...totals, net: totals.net };
  const before = round2(totals.net + totals.overhead);
  const subject = kind === 'daily'
    ? `Daily report ${to}: ${totals.net < 0 ? 'lost' : 'made'} ${fmt(Math.abs(totals.net))} (${fmt(before)} before overhead)`
    : `Weekly report ${from} to ${to}: net ${fmt(totals.net)} (${fmt(before)} before overhead)`;
  const th = 'style="text-align:right;padding:6px 8px;border-bottom:2px solid #222;font-size:12px"';
  const td = 'style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd"';
  const head = `<tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #222;font-size:12px">${kind === 'daily' ? 'Day' : 'Day'}</th>${COLS.map(([l]) => `<th ${th}>${l}</th>`).join('')}<th ${th}>Net before overhead</th></tr>`;
  const line = (label, r, bold) => `<tr style="${bold ? 'font-weight:bold;background:#f4f4f4' : ''}"><td style="padding:6px 8px;border-bottom:1px solid #ddd">${esc(label)}</td>${
    COLS.map(([, k, neg]) => `<td ${td}${k === 'net' ? ` style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;color:${colour(r[k])}"` : ''}>${fmt(neg ? -r[k] : r[k])}</td>`).join('')
  }<td style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;color:${colour(netBeforeOverhead(r))}">${fmt(netBeforeOverhead(r))}</td></tr>`;
  const body = (kind === 'daily' ? rows : rows).map((r) => line(dayLabel(r.day), r)).join('') + (rows.length > 1 ? line('Total', { ...t, day: '' }, true) : '');
  const made = kind === 'weekly' ? `<p>${totals.daysMade} day${totals.daysMade === 1 ? '' : 's'} made money, ${totals.daysLost} lost.</p>` : '';
  const warn = warnings.length ? `<h3 style="margin:16px 0 4px">To check</h3><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
    <h2 style="margin:0 0 4px">${kind === 'daily' ? 'Daily' : 'Weekly'} P&amp;L: ${kind === 'daily' ? esc(dayLabel(to)) : `${esc(dayLabel(from))} to ${esc(dayLabel(to))}`}</h2>
    <p style="margin:0 0 12px;font-size:20px"><b style="color:${colour(before)}">${fmt(before)}</b> net before overhead &middot; <b style="color:${colour(totals.net)}">${fmt(totals.net)}</b> after overhead</p>
    ${made}
    <table style="border-collapse:collapse;width:100%;font-size:13px">${head}${body}</table>
    ${warn}
    <p style="color:#666;font-size:12px;margin-top:16px">Product profit is price less cost on units sold that day. Service calls and pickups count only when they carry a charge. Overhead is the cost list spread over the days it covers. The same figures as Admin &rarr; Daily P&amp;L.</p>
  </div>`;
  return { subject, html };
}

export async function sendPnlReport({ kind, today = torontoToday(), to = SERVICE_EMAIL, send = true, asOf = null } = {}) {
  const range = kind === 'weekly' ? thisWeek(today) : { from: today, to: today };
  const result = await dailyPnl({ ...range, asOf });
  const mail = renderReport({ kind, result });
  const sent = send ? await sendEmail({ to, subject: mail.subject, html: mail.html }).catch((e) => ({ ok: false, error: e?.message })) : null;
  return { range, totals: result.totals, subject: mail.subject, sent };
}

// ---- When the daily report goes out ---------------------------------------------------------
// A report built while somebody is still clocked in is wrong (their wages are missing), so the
// daily report WAITS until everyone has clocked out. The cron calls this every few minutes from
// 9pm; it sends the moment nobody is clocked in. If someone is STILL on the clock at midnight it
// goes at 12:01am anyway, counting each open shift as ending at midnight (nothing is written to
// the shift itself: it stays open and is costed properly when they clock out).

const tzParts = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
};

/** The instant 00:00 Toronto on `date` (YYYY-MM-DD), as an ISO string. Handles DST. */
export function torontoMidnightIso(date) {
  const [y, m, d] = date.split('-').map(Number);
  for (const off of [4, 5]) {                       // EDT = UTC-4, EST = UTC-5
    const t = new Date(Date.UTC(y, m - 1, d, off, 0, 0));
    const q = tzParts(t);
    if (q.date === date && q.hour === 0 && q.minute === 0) return t.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString();
}

export async function openClockCount() {
  if (!hasDb()) return 0;
  let n = 0;
  for (const t of ['staff_shifts', 'driver_shifts']) {
    try { n += Number((await query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ended_at IS NULL`)).rows[0]?.n || 0); } catch { /* table absent */ }
  }
  return n;
}

/** Pure decision: what should the cron do right now? */
export function dailyReportDecision({ now = tzParts(), open, alreadySent }) {
  const reportDay = now.hour >= 12 ? now.date : new Date(new Date(`${now.date}T12:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
  if (alreadySent === reportDay) return { action: 'skip', reason: 'already sent', reportDay };
  if (now.hour >= 12 && now.hour < 21) return { action: 'skip', reason: 'too early', reportDay };
  if (now.hour >= 21) {
    return open === 0 ? { action: 'send', reportDay, forced: false } : { action: 'wait', reason: `${open} still clocked in`, reportDay };
  }
  // after midnight: 12:01am onwards
  if (now.hour === 0 && now.minute < 1) return { action: 'wait', reason: 'before 12:01am', reportDay };
  return { action: 'send', reportDay, forced: open > 0 };
}

export async function sendDailyReportWhenReady({ send = true, force = false } = {}) {
  const now = tzParts();
  const open = await openClockCount();
  const alreadySent = await getSetting('daily_report_sent', null);
  let d = dailyReportDecision({ now, open, alreadySent });
  if (force && d.action !== 'send') d = { action: 'send', reportDay: now.date, forced: open > 0 };
  if (d.action !== 'send') return { ...d, open };
  // Claim the day first so overlapping cron hits cannot send twice; hand it back if the send fails.
  if (send) await setSetting('daily_report_sent', d.reportDay);
  const asOf = d.forced ? torontoMidnightIso(new Date(new Date(`${d.reportDay}T12:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10)) : null;
  const r = await sendPnlReport({ kind: 'daily', today: d.reportDay, send, asOf });
  if (send && r.sent && r.sent.ok === false && !r.sent.skipped) await setSetting('daily_report_sent', alreadySent || null);
  return { ...d, open, asOf, ...r };
}

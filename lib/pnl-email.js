// The Daily and Weekly P&L emails: the Daily P&L page's own table, mailed to the office.
//
// It is dailyPnl() and nothing else, so the email, the page and the dispatch Profit tab cannot disagree.
// Net is shown two ways because both get asked for: the page's net (after the cost-list overhead) and
// net before overhead ("excluding other bills"), which is the figure the owner reads the week by.
import { dailyPnl } from './daily-pnl';
import { daysBetween } from './daily-cost-math';
import { torontoToday, round2, SERVICE_EMAIL } from './constants';
import { sendEmail } from './email';

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

/** { from, to } of the Monday-to-Sunday week that ended before `today`. Pure. */
export function lastFullWeek(today = torontoToday()) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();            // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const thisMonday = addDays(today, -sinceMonday);
  return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
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
    <p style="color:#666;font-size:12px;margin-top:16px">Product profit is price less cost on units sold that day. Deliveries billed excludes service calls and pickups, which bring in $0. Overhead is the cost list spread over the days it covers. The same figures as Admin &rarr; Daily P&amp;L.</p>
  </div>`;
  return { subject, html };
}

export async function sendPnlReport({ kind, today = torontoToday(), to = SERVICE_EMAIL, send = true } = {}) {
  const range = kind === 'weekly' ? lastFullWeek(today) : { from: today, to: today };
  const result = await dailyPnl(range);
  const mail = renderReport({ kind, result });
  const sent = send ? await sendEmail({ to, subject: mail.subject, html: mail.html }).catch((e) => ({ ok: false, error: e?.message })) : null;
  return { range, totals: result.totals, subject: mail.subject, sent };
}

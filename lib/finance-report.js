// The weekly P&L — one number set answering "what did I actually make this
// week?": revenue − COGS − labor − expenses − ad spend = net. Weeks are Mon–Sun
// in America/Toronto, the same weeks payroll runs on. Powers the finance_report
// agent tool and the Monday-morning Telegram brief to the management group.
import { query, hasDb } from './db';
import { laborCostBetween } from './payroll';
import { getSetting, setSetting } from './settings';
import { sendMessage as tgSend } from './telegram';

const SALE = "('confirmed','ready','out_for_delivery','delivered')";
const TZ = "AT TIME ZONE 'America/Toronto'";
const NOW = `(now() ${TZ})`;
const n = (v) => Number(v || 0);
const fmt = (v) => '$' + n(v).toFixed(2);

// weekOffset: 0 = this week (Mon–now), -1 = last week, etc.
export async function weeklyPnl({ weekOffset = 0 } = {}) {
  if (!hasDb()) return null;
  const off = Math.max(Math.min(parseInt(weekOffset, 10) || 0, 0), -52);
  const ws = `(date_trunc('week', ${NOW}) + interval '${off} weeks')`;
  const we = `(${ws} + interval '7 days')`;
  const inWin = (expr) => `${expr} >= ${ws} AND ${expr} < ${we}`;
  const LT = (col) => `(${col} ${TZ})`;

  // Pre-tax revenue + orders + units from confirmed sales.
  const rev = (await query(`
    SELECT COALESCE(SUM(total - COALESCE(hst,0)),0) AS revenue,
           COALESCE(SUM(COALESCE(hst,0)),0) AS hst, COUNT(*) AS orders
      FROM orders WHERE status IN ${SALE} AND ${inWin(LT('created_at'))}`)).rows[0] || {};
  const cg = (await query(`
    SELECT COUNT(oi.id) FILTER (WHERE oi.sku IS NOT NULL) AS units,
           COALESCE(SUM(COALESCE(oi.cost, p.cost)),0) AS cogs
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE o.status IN ${SALE} AND ${inWin(LT('o.created_at'))}`)).rows[0] || {};

  // Labor (payroll math over the same window).
  let labor = 0;
  try { labor = (await laborCostBetween(ws, we)).total; } catch { /* no labor table */ }

  // Operating expenses + ad spend inside the week.
  let expenses = 0, expensesByCategory = [];
  try {
    expensesByCategory = (await query(`
      SELECT COALESCE(category,'Other') AS category, COALESCE(SUM(amount),0) AS amount
        FROM expenses WHERE ${inWin('incurred_on')} GROUP BY 1 ORDER BY amount DESC`)).rows
      .map((r) => ({ category: r.category, amount: n(r.amount) }));
    expenses = expensesByCategory.reduce((s, e) => s + e.amount, 0);
  } catch { /* no expenses table */ }
  let adSpend = 0;
  try { adSpend = n((await query(`SELECT COALESCE(SUM(amount),0) AS a FROM ad_spend WHERE ${inWin('spent_on')}`)).rows[0]?.a); } catch { /* ignore */ }

  // Open AR — money owed right now (not week-scoped).
  let owed = 0, owedOverdue = 0;
  try {
    const a = (await query(`
      SELECT COALESCE(SUM(total),0) AS total,
             COALESCE(SUM(total) FILTER (WHERE due_date < now()::date),0) AS overdue
        FROM invoices WHERE status='open'`)).rows[0] || {};
    owed = n(a.total); owedOverdue = n(a.overdue);
  } catch { /* no invoices table */ }

  const { rows: wk } = await query(`SELECT ${ws}::date AS ws, (${we}::date - 1) AS we`);
  const revenue = n(rev.revenue), cogs = n(cg.cogs);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - labor - expenses - adSpend;

  return {
    weekOffset: off,
    weekStart: wk[0].ws.toISOString().slice(0, 10),
    weekEnd: wk[0].we.toISOString().slice(0, 10),
    revenue, hstCollected: n(rev.hst), orders: n(rev.orders), units: n(cg.units),
    cogs, grossProfit, labor, expenses, expensesByCategory, adSpend, netProfit,
    owed, owedOverdue
  };
}

// Plain-text brief (Telegram has no markdown mode on our sendMessage).
export function formatFinanceBrief(p) {
  const lines = [
    `📊 Weekly finance report — ${p.weekStart} to ${p.weekEnd}`,
    '',
    `Revenue: ${fmt(p.revenue)} (${p.orders} orders, ${p.units} units)`,
    `Cost of goods: −${fmt(p.cogs)}`,
    `Gross profit: ${fmt(p.grossProfit)}`,
    `Labor (payroll): −${fmt(p.labor)}`,
    `Expenses: −${fmt(p.expenses)}` +
      (p.expensesByCategory.length ? ` (${p.expensesByCategory.map((e) => `${e.category} ${fmt(e.amount)}`).join(', ')})` : ''),
    p.adSpend > 0 ? `Ad spend: −${fmt(p.adSpend)}` : null,
    '',
    `💰 NET: ${fmt(p.netProfit)}`,
    '',
    p.owed > 0 ? `Owed to you (open invoices): ${fmt(p.owed)}${p.owedOverdue > 0 ? ` — ${fmt(p.owedOverdue)} overdue` : ''}` : 'No open invoices outstanding.',
    p.expenses === 0 ? '⚠️ No expenses logged this week — tell me "log expense …" or set recurring ones on the Financial dashboard so NET is real.' : null,
    p.labor === 0 ? '⚠️ No labor recorded this week (crew self-reports to the bot; delivery/hourly rates live in /admin/payroll).' : null
  ].filter((l) => l !== null);
  return lines.join('\n');
}

// Send last week's P&L to the management Telegram group every Monday (Toronto).
// Runs from the daily cron; the settings key makes it once-per-week idempotent.
// force=true skips the Monday/dedupe gates (owner asking for it right now).
export async function sendWeeklyFinanceBrief({ force = false } = {}) {
  if (!hasDb()) return { sent: false, reason: 'no db' };
  const target = process.env.SARAH_TELEGRAM_MGMT_GROUP ||
    (process.env.SARAH_TELEGRAM_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (!target || !process.env.TELEGRAM_BOT_TOKEN) return { sent: false, reason: 'telegram not configured' };

  const now = new Date();
  const isMonday = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', weekday: 'short' }) === 'Mon';
  if (!force && !isMonday) return { sent: false, reason: 'not Monday' };

  const p = await weeklyPnl({ weekOffset: -1 });
  if (!p) return { sent: false, reason: 'no data' };
  if (!force) {
    const last = await getSetting('finance_brief_last', null);
    if (last === p.weekStart) return { sent: false, reason: 'already sent this week' };
  }
  await tgSend(target, formatFinanceBrief(p));
  await setSetting('finance_brief_last', p.weekStart).catch(() => {});
  return { sent: true, week: `${p.weekStart}..${p.weekEnd}`, net: p.netProfit };
}

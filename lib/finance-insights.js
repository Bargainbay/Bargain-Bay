// The owner's view on the Financial dashboard: where cash is heading, what the business is worth, whether it is
// clearing its costs, and where the money is stuck. Read-only, apart from one saved net-worth figure per month.
//
// It reuses the same sale rule and the same cost rules as the cards above it, so the two cannot disagree. Every
// block is loaded on its own: a block that cannot be read says so, and is never shown as zero.
import { query, hasDb } from './db';
import { round2, torontoToday, HST_RATE, leadSourceLabel } from './constants';
import { SALE, financialDashboard, hstRemittance, notOperatingCost, isWageCategory, dashWindowSql } from './analytics';
import { laborCostBetween } from './payroll';
import { ensureFinanceSchema } from './finance';
import { consignmentOwed, consignedSkus } from './consignment';
import { storeCreditOutstanding } from './store-credit';
import { readTrackerRows, sheetsConfigured } from './sheets';
import { costFromRow, parseCostCell } from './tracker-cost';
import { isSoldStatus } from './stock-match';
import { getSetting, setSetting } from './settings';
import {
  addDays, daysFrom, isoDay, hstDueDate, projectQuarterNet, netWorth, monthTrend, projection, breakEven,
  ageStock, groupReturns, cashCycle, adReturn, platformOf
} from './finance-insights-math';

const TZ = "AT TIME ZONE 'America/Toronto'";
const LT = (col) => `(${col} ${TZ})`;
const n = (v) => Number(v || 0);
const NOT_CREDIT = "lower(method) <> 'store credit'";

const block = async (name, fn) => {
  try { return await fn(); } catch (e) { console.error(`finance insights: ${name} failed`, e?.message || e); return { error: true }; }
};
const ok = (b) => b && !b.error;

// E-transfers the bank reported that nobody has sorted into a cost. They are NOT expenses, so profit does not
// see them, but the money did leave. Some pay suppliers; some may be bills, wages or draws. Null = not known.
async function unsortedOut(where, params = []) {
  try {
    const r = (await query(`SELECT COALESCE(SUM(-amount),0) AS v, COUNT(*)::int AS c FROM bank_activity WHERE amount < 0 AND pending = false AND ${where}`, params)).rows[0];
    return { total: round2(n(r.v)), count: r.c };
  } catch { return null; }
}

// ---- what has actually been moving, over the last four weeks ----------------
// The window never starts before the bank feed does: averaging four weeks of bills over weeks nothing was
// recorded in would report half the real running cost.
async function recentFlows(today) {
  await ensureFinanceSchema();
  const first = (await query(`SELECT to_char(MIN(incurred_on),'YYYY-MM-DD') AS d FROM expenses WHERE source = 'plaid'`)).rows[0]?.d || null;
  const back = addDays(today, -27);
  const since = first && first > back ? first : back;
  const days = daysFrom(since, today) + 1;
  const spend = (await query(
    `SELECT COALESCE(category,'Other') AS category, COALESCE(SUM(amount + COALESCE(tax,0)),0) AS v
       FROM expenses WHERE incurred_on BETWEEN $1::date AND $2::date GROUP BY 1`, [since, today])).rows;
  const ads = n((await query(`SELECT COALESCE(SUM(amount + COALESCE(tax,0)),0) AS v FROM ad_spend WHERE spent_on BETWEEN $1::date AND $2::date`,
    [since, today]).catch(() => ({ rows: [{}] }))).rows[0]?.v);
  const sum = (test) => round2(spend.filter((r) => test(r.category)).reduce((a, r) => a + n(r.v), 0));
  const draws = sum((c) => /^(owner draw|loan repayment)/i.test(c));
  const supplierPaid = sum((c) => /^supplier payment/i.test(c));
  const wages = sum((c) => isWageCategory(c));
  const running = round2(sum((c) => !notOperatingCost(c) && !isWageCategory(c)) + ads);
  const collected = n((await query(
    `SELECT COALESCE(SUM(amount),0) AS v FROM invoice_payments WHERE ${NOT_CREDIT} AND (paid_at ${TZ})::date BETWEEN $1::date AND $2::date`,
    [since, today])).rows[0].v);
  const sold = (await query(
    `SELECT COALESCE(SUM(o.total - COALESCE(o.hst,0) - COALESCE(o.vendor_subtotal,0)),0) AS sales
       FROM orders o WHERE ${SALE('o')} AND ${LT('o.created_at')}::date BETWEEN $1::date AND $2::date`, [since, today])).rows[0];
  const cogs = n((await query(
    `SELECT COALESCE(SUM(COALESCE(oi.cost, p.cost)),0) AS v FROM order_items oi JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.sku = oi.sku
      WHERE ${SALE('o')} AND oi.vendor_id IS NULL AND ${LT('o.created_at')}::date BETWEEN $1::date AND $2::date`, [since, today])).rows[0].v);
  const unsorted = await unsortedOut('activity_date BETWEEN $1::date AND $2::date', [since, today]);
  return { since, days, collected: round2(collected), sales: round2(n(sold.sales)), cogs: round2(cogs), wages, running, draws, supplierPaid, unsorted: unsorted?.total ?? null, bankFeed: !!first };
}

// Ninety days of selling, for margin and how fast stock and invoices turn.
async function quarterFlows(today) {
  const first = (await query(`SELECT to_char(MIN(${LT('o.created_at')}),'YYYY-MM-DD') AS d FROM orders o WHERE ${SALE('o')}`)).rows[0]?.d || today;
  const back = addDays(today, -89);
  const since = first > back ? first : back;
  const days = daysFrom(since, today) + 1;
  const o = (await query(
    `SELECT COALESCE(SUM(o.total - COALESCE(o.hst,0) - COALESCE(o.vendor_subtotal,0)),0) AS sales,
            COALESCE(SUM(o.total - COALESCE(o.vendor_subtotal,0) - COALESCE(o.vendor_hst,0)),0) AS with_tax
       FROM orders o WHERE ${SALE('o')} AND ${LT('o.created_at')}::date BETWEEN $1::date AND $2::date`, [since, today])).rows[0];
  const l = (await query(
    `SELECT COALESCE(SUM(COALESCE(oi.cost, p.cost)),0) AS cogs,
            COALESCE(SUM(oi.price) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND COALESCE(oi.cost, p.cost) IS NULL),0) AS uncosted
       FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.sku = oi.sku
      WHERE ${SALE('o')} AND oi.vendor_id IS NULL AND ${LT('o.created_at')}::date BETWEEN $1::date AND $2::date`, [since, today])).rows[0];
  const costed = n(o.sales) - n(l.uncosted);
  // Sales whose unit has no cost are left out of the margin: counted, they would read as pure profit.
  const margin = costed > 0 ? (costed - n(l.cogs)) / costed : null;
  const purchases = (await query(`SELECT COALESCE(SUM(total),0) AS v FROM purchase_invoices WHERE invoice_date BETWEEN $1::date AND $2::date`, [since, today])
    .catch(() => ({ rows: [{ v: null }] }))).rows[0].v;
  return { since, days, sales: n(o.sales), salesWithTax: n(o.with_tax), cogs: n(l.cogs), uncosted: n(l.uncosted), margin, purchases: purchases == null ? null : n(purchases) };
}

// ---- balances ---------------------------------------------------------------
async function receivablesNow() {
  const r = (await query(
    `SELECT COALESCE(SUM(i.total - pay.paid),0) AS v, COUNT(*)::int AS c FROM invoices i
       LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments p WHERE p.invoice_id = i.id) pay ON true
      WHERE i.status IN ('open','partial')`)).rows[0];
  return { total: round2(n(r.v)), count: r.c };
}
async function suppliersOwed(today) {
  const r = (await query(
    `SELECT COALESCE(SUM(total),0) AS v, COUNT(*)::int AS c,
            COALESCE(SUM(total) FILTER (WHERE invoice_date < $1::date - 60),0) AS old
       FROM purchase_invoices WHERE paid_at IS NULL`, [today])).rows[0];
  return { total: round2(n(r.v)), count: r.c, over60: round2(n(r.old)) };
}
async function consignmentBalance() {
  // consignmentOwed() answers "nothing" when it cannot read; ask the table first so unreadable stays unknown.
  await query('SELECT 1 FROM consignment_units LIMIT 1');
  const rows = await consignmentOwed();
  return { total: round2(rows.reduce((a, r) => a + r.cost, 0)), count: rows.length };
}
function wagesOwed(pay) {
  if (!pay || !Array.isArray(pay.people)) return { error: true };
  const total = pay.people.reduce((a, p) => a + Math.max(0, n(p.balance)), 0);
  const week = pay.people.reduce((a, p) => a + Math.max(0, n(p.thisWeek) - n(p.thisWeekPaid)), 0);
  return { total: round2(total), thisWeek: round2(week) };
}

// ---- stock, from the tracker ------------------------------------------------
// The tracker, not the website: untested and in-repair units are where money sits longest.
async function stockUnits() {
  if (!sheetsConfigured()) return { error: true };
  const rows = await readTrackerRows();
  const safe = async (sql) => { try { return (await query(sql)).rows; } catch { return []; } };
  const soldRows = await safe(
    `SELECT upper(trim(oi.sku)) AS sku, oi.price, to_char(${LT('o.created_at')},'YYYY-MM-DD') AS d
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${SALE('o')} AND oi.sku IS NOT NULL AND COALESCE(oi.kind,'unit') = 'unit' ORDER BY o.created_at`);
  const sales = new Map(soldRows.map((r) => [r.sku, { price: n(r.price), on: r.d }]));
  const marked = new Set((await safe(`SELECT upper(trim(sku)) AS sku FROM products WHERE sold_at IS NOT NULL`)).map((r) => r.sku));
  const scrapped = new Set((await safe(`SELECT upper(trim(sku)) AS sku FROM salvage_units WHERE status = 'disposed'`)).map((r) => r.sku));
  const consigned = new Set([...(await consignedSkus())].map((s) => String(s).trim().toUpperCase()));
  const seen = new Set(), units = [];
  for (const r of rows) {
    const key = String(r.sku).trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sale = sales.get(key);
    const isConsigned = consigned.has(key) || /^consignment/i.test(String(r.invoice || '').trim());
    units.push({
      sku: r.sku, lot: r.lot, vendor: r.vendor, make: r.make, model: r.model, category: r.category, status: r.status || 'Untested',
      cost: costFromRow(r), consigned: isConsigned,
      salvage: /salvage/i.test(r.status || ''), gone: scrapped.has(key),
      sold: !!sale || marked.has(key) || isSoldStatus(r.status),
      soldPrice: sale ? sale.price : parseCostCell(r.soldPrice),
      soldOn: sale ? sale.on : isoDay(r.dateSold),
      received: isoDay(r.dateReceived)
    });
  }
  return { units };
}

export function stockPicture(units, today) {
  const onHand = units.filter((u) => !u.sold && !u.gone);
  const owned = onHand.filter((u) => !u.consigned);
  const sum = (list) => round2(list.reduce((a, u) => a + n(u.cost), 0));
  const oldest = owned.filter((u) => u.received && u.cost > 0)
    .map((u) => ({ ...u, age: daysFrom(u.received, today) }))
    .filter((u) => u.age > 90).sort((a, b) => b.cost - a.cost).slice(0, 15);
  // Profit on a vendor's consigned unit is measured against its cost before tax, the same as the Daily P&L.
  const forReturns = units.map((u) => (u.consigned && u.cost != null ? { ...u, cost: round2(u.cost / (1 + HST_RATE)) } : u));
  const dated = units.filter((u) => u.sold && u.received && u.soldOn && u.soldOn >= u.received && u.soldOn >= addDays(today, -89));
  return {
    ownedCost: sum(owned), ownedUnits: owned.length, noCost: owned.filter((u) => u.cost == null).length,
    salvageCost: sum(owned.filter((u) => u.salvage)),
    consignedCost: sum(onHand.filter((u) => u.consigned)), consignedUnits: onHand.filter((u) => u.consigned).length,
    ages: ageStock(owned, today), oldest,
    daysToSell: dated.length ? Math.round(dated.reduce((a, u) => a + daysFrom(u.received, u.soldOn), 0) / dated.length) : null,
    datedSales: dated.length,
    byLot: groupReturns(forReturns, (u) => u.lot),
    byVendor: groupReturns(forReturns, (u) => u.vendor),
    byBrand: groupReturns(forReturns, (u) => u.make),
    byCategory: groupReturns(forReturns, (u) => u.category)
  };
}

// ---- twelve months ----------------------------------------------------------
async function months(today) {
  await ensureFinanceSchema();
  const firstSale = (await query(`SELECT to_char(MIN(${LT('o.created_at')}),'YYYY-MM') AS m FROM orders o WHERE ${SALE('o')}`)).rows[0]?.m;
  if (!firstSale) return { rows: [] };
  const [y, m] = today.split('-').map(Number);
  const list = [];
  for (let i = 11; i >= 0; i--) {
    const key = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    if (key >= firstSale) list.push(key);
  }
  const from = `${list[0]}-01`;
  const map = async (sql) => new Map((await query(sql, [from])).rows.map((r) => [r.m, r]));
  const [rev, cogs, spend, ads] = await Promise.all([
    map(`SELECT to_char(${LT('o.created_at')},'YYYY-MM') AS m, COALESCE(SUM(o.total - COALESCE(o.hst,0) - COALESCE(o.vendor_subtotal,0)),0) AS v
           FROM orders o WHERE ${SALE('o')} AND ${LT('o.created_at')}::date >= $1::date GROUP BY 1`),
    map(`SELECT to_char(${LT('o.created_at')},'YYYY-MM') AS m, COALESCE(SUM(COALESCE(oi.cost, p.cost)),0) AS v
           FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.sku = oi.sku
          WHERE ${SALE('o')} AND oi.vendor_id IS NULL AND ${LT('o.created_at')}::date >= $1::date GROUP BY 1`),
    query(`SELECT to_char(incurred_on,'YYYY-MM') AS m, COALESCE(category,'Other') AS category, COALESCE(SUM(amount),0) AS v,
                  COUNT(*) FILTER (WHERE source = 'plaid')::int AS bank
             FROM expenses WHERE incurred_on >= $1::date GROUP BY 1, 2`, [from]).then((r) => r.rows),
    map(`SELECT to_char(spent_on,'YYYY-MM') AS m, COALESCE(SUM(amount),0) AS v FROM ad_spend WHERE spent_on >= $1::date GROUP BY 1`)
  ]);
  const rows = [];
  for (const key of list) {
    const mine = spend.filter((r) => r.m === key);
    const total = (test) => round2(mine.filter((r) => test(r.category)).reduce((a, r) => a + n(r.v), 0));
    const piece = await laborCostBetween(`date '${key}-01'`, `date '${key}-01' + interval '1 month'`).then((x) => x.total).catch(() => 0);
    rows.push({
      month: key, revenue: round2(n(rev.get(key)?.v)), cogs: round2(n(cogs.get(key)?.v)),
      wages: round2(total(isWageCategory) + piece),
      costs: total((c) => !notOperatingCost(c) && !isWageCategory(c)),
      ads: round2(n(ads.get(key)?.v)),
      // A month with next to no bank lines is a month whose bills were never recorded: its profit reads too high.
      thin: mine.reduce((a, r) => a + r.bank, 0) < 20,
      partial: key === today.slice(0, 7)
    });
  }
  return { rows: monthTrend(rows) };
}

// ---- advertising ------------------------------------------------------------
async function advertising(period) {
  await ensureFinanceSchema();
  const [cs, ce] = dashWindowSql(period);
  const inCur = (x) => `${x} >= ${cs} AND ${x} < ${ce}`;
  const bank = (await query(
    `SELECT COALESCE(category,'') AS category, COALESCE(vendor,'') AS vendor, SUM(amount) AS v FROM expenses
      WHERE ${inCur('incurred_on')} AND category ILIKE 'advertis%' GROUP BY 1, 2`)).rows
    .map((r) => ({ platform: platformOf(`${r.category} ${r.vendor}`), amount: n(r.v) }));
  const typed = (await query(`SELECT channel, SUM(amount) AS v FROM ad_spend WHERE ${inCur('spent_on')} GROUP BY 1`)).rows
    .map((r) => ({ platform: platformOf(r.channel), amount: n(r.v) }));
  const sales = (await query(
    `SELECT COALESCE(o.lead_source,'') AS source, COUNT(*)::int AS sales,
            COALESCE(SUM(o.total - COALESCE(o.hst,0) - COALESCE(o.vendor_subtotal,0)),0) AS revenue,
            COALESCE(SUM(l.cost),0) AS cost
       FROM orders o
       LEFT JOIN LATERAL (SELECT SUM(COALESCE(oi.cost, p.cost)) AS cost FROM order_items oi LEFT JOIN products p ON p.sku = oi.sku
                           WHERE oi.order_id = o.id AND oi.vendor_id IS NULL) l ON true
      WHERE ${SALE('o')} AND ${inCur(LT('o.created_at'))} GROUP BY 1`)).rows
    .map((r) => ({ source: r.source, label: leadSourceLabel(r.source) || 'Not recorded', sales: r.sales, revenue: n(r.revenue), profit: round2(n(r.revenue) - n(r.cost)) }));
  return adReturn({ bank, typed, sales });
}

// ---- net worth --------------------------------------------------------------
const HISTORY = 'net_worth_history';
export function worthNow({ bankroll, receivables, stock, suppliers, consignment, wages, hst, credit }) {
  const known = (b, v) => (ok(b) ? v : null);
  return netWorth({
    assets: [
      { label: 'Cash (bank and till)', value: bankroll && bankroll.bankKnown && bankroll.cashKnown ? bankroll.total : null },
      { label: 'Owed to us by customers', value: known(receivables, receivables?.total) },
      { label: 'Stock we own, at cost', value: known(stock, stock?.ownedCost), note: 'from the tracker, including untested, in repair and salvage; consigned units left out. A unit sold on a typed invoice line with nothing attached still counts' }
    ],
    liabilities: [
      { label: 'Owed to suppliers', value: known(suppliers, suppliers?.total), note: 'invoices not marked paid' },
      { label: 'Owed to consignment vendors', value: known(consignment, consignment?.total), note: 'sold units not marked paid' },
      { label: 'Wages owed', value: known(wages, round2(n(wages?.total) + n(wages?.thisWeek))), note: 'including this week so far' },
      { label: 'HST owed this quarter', value: known(hst, Math.max(0, n(hst?.net))) },
      { label: 'Store credit not yet spent', value: known(credit, credit?.total) }
    ]
  });
}
// One figure per month, overwritten until the month ends. Never saved from an incomplete reading.
export async function saveNetWorth(worth, today = torontoToday()) {
  const history = (await getSetting(HISTORY, {})) || {};
  if (worth?.complete) {
    history[today.slice(0, 7)] = { on: today, assets: worth.totalAssets, liabilities: worth.totalLiabilities, net: worth.net };
    await setSetting(HISTORY, history);
  }
  return Object.entries(history).sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({ month, ...v }));
}

async function currentHst(today) {
  const t = await hstRemittance('month');
  const q = t?.quarters?.find((x) => x.inProgress);
  if (!q) return { error: true };
  const quarter = Number(q.quarter.slice(1)), year = t.year;
  const prev = t.quarters.find((x) => x.quarter === `Q${quarter - 1}`) || null;
  return {
    net: q.net, quarter: q.quarter, due: hstDueDate(year, quarter),
    projected: projectQuarterNet({ netToDate: q.net, today, year, quarter }),
    previous: prev ? { quarter: prev.quarter, net: prev.net, due: hstDueDate(year, quarter - 1) } : null
  };
}

async function balances(today, bankroll) {
  const [receivables, suppliers, consignment, credit, hst, tracker] = await Promise.all([
    block('receivables', receivablesNow),
    block('suppliers', () => suppliersOwed(today)),
    block('consignment', consignmentBalance),
    block('store credit', async () => ({ total: await storeCreditOutstanding() })),
    block('hst', () => currentHst(today)),
    block('stock', stockUnits)
  ]);
  const stock = ok(tracker) ? await block('stock picture', async () => stockPicture(tracker.units, today)) : { error: true };
  return { bankroll, receivables, suppliers, consignment, credit, hst, stock, wages: wagesOwed(bankroll?.pay) };
}

// The nightly pass calls this so the month has a figure even if nobody opens the page.
export async function recordNetWorthSnapshot() {
  if (!hasDb()) return null;
  const today = torontoToday();
  const { loadBankroll } = await import('./bankroll-load');
  const worth = worthNow(await balances(today, await loadBankroll()));
  await saveNetWorth(worth, today);
  return worth.complete ? worth.net : null;
}

export const TARGET_KEY = 'finance_targets';
export async function setFinanceTargets(input = {}) {
  const clean = {};
  for (const k of ['revenue', 'gross', 'net']) {
    const raw = input[k];
    if (raw === '' || raw == null) { clean[k] = null; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 100000000) throw new Error('Each target is a dollar amount, or blank for none.');
    clean[k] = round2(v);
  }
  await setSetting(TARGET_KEY, clean);
  return clean;
}

export async function financeInsights({ period = 'month', bankroll = null } = {}) {
  if (!hasDb()) return null;
  const today = torontoToday();
  // In small groups: the database pool is five connections, and a page that queues dozens of queries at once
  // times some of them out.
  const bal = await balances(today, bankroll);
  const [flows, quarter] = await Promise.all([
    block('recent flows', () => recentFlows(today)),
    block('quarter flows', () => quarterFlows(today))
  ]);
  const [trend, ads, targets] = await Promise.all([
    block('months', () => months(today)),
    block('advertising', () => advertising(period)),
    block('targets', async () => {
      const saved = (await getSetting(TARGET_KEY, null)) || {};
      const goal = Number(await getSetting('revenue_goal_monthly', 0)) || null;
      return { revenue: saved.revenue ?? goal, gross: saved.gross ?? null, net: saved.net ?? null };
    })
  ]);
  const periodFigures = await block('period', () => financialDashboard(period));
  const month = period === 'month' ? periodFigures : await block('this month', () => financialDashboard('month'));
  const { stock, receivables, suppliers, wages, hst } = bal;
  const worth = worthNow(bal);
  const history = await block('net worth history', async () => ({ rows: await saveNetWorth(worth, today) }));

  // 1. Profit, down to what is left once the owners have been paid.
  let profit = { error: true };
  if (ok(periodFigures)) {
    const k = periodFigures.kpis;
    const draws = round2((periodFigures.leftOut || []).filter((e) => /^owner draw/i.test(e.category)).reduce((a, e) => a + e.amount, 0));
    const loans = round2((periodFigures.leftOut || []).filter((e) => /^loan repayment/i.test(e.category)).reduce((a, e) => a + e.amount, 0));
    const [cs, ce] = dashWindowSql(period);
    const unsorted = await unsortedOut(`activity_date >= ${cs} AND activity_date < ${ce}`);
    profit = { unsorted, revenue: k.revenue, cogs: k.cogs, gross: k.grossProfit, wages: k.labor, running: k.expenses, ads: k.adSpend, net: k.netProfit,
      draws, loans, kept: round2(k.netProfit - draws - loans), owed: ok(wages) ? wages : null };
  }

  // 2. Cash forecast assumptions. Recent actuals; the page lets the owner change any of them.
  let forecast = { error: true };
  if (ok(flows) && bankroll && bankroll.bankKnown) {
    const weekly = (v) => round2((v / flows.days) * 7);
    const dated = ok(hst) && hst.projected > 0 ? [{ date: hst.due, amount: hst.projected, label: `${hst.quarter} HST` }] : [];
    forecast = {
      today, start: bankroll.total, cashKnown: bankroll.cashKnown, window: { since: flows.since, days: flows.days }, bankFeed: flows.bankFeed,
      weeklyIn: weekly(flows.collected), weeklyWages: weekly(flows.wages), weeklyRunning: weekly(flows.running),
      weeklyDraws: weekly(flows.draws), weeklyCogs: weekly(flows.cogs), weeklySupplierPaid: weekly(flows.supplierPaid),
      weeklyUnsorted: weekly(flows.unsorted || 0),
      // What leaves for stock: never less than the cost of what is selling, and never less than what the bank shows
      // actually going out to suppliers and in unsorted e-transfers.
      weeklyStock: Math.max(weekly(flows.cogs), weekly(flows.supplierPaid + (flows.unsorted || 0))),
      owedOld: round2((ok(suppliers) ? suppliers.total : 0) + (ok(bal.consignment) ? bal.consignment.total : 0)),
      dated, previousHst: ok(hst) ? hst.previous : null
    };
  }

  // 5. Targets against this month, with where it lands at the current pace.
  let goals = { error: true };
  if (ok(month) && ok(targets)) {
    const [y, m, d] = today.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const k = month.kpis;
    const line = (label, key, actual) => ({ label, key, ...projection({ actual, target: targets[key], day: d, daysInMonth }) });
    goals = { targets, day: d, daysInMonth, lines: [line('Sales (before tax)', 'revenue', k.revenue), line('Gross profit', 'gross', k.grossProfit), line('Net profit', 'net', k.netProfit)] };
  }

  // 6. Break-even and runway.
  const even = ok(flows) && ok(quarter)
    ? { ...breakEven({ costs: flows.wages + flows.running, days: flows.days, sales: flows.sales, margin: quarter.margin,
        cash: bankroll && bankroll.bankKnown ? bankroll.total : null }), since: flows.since, days: flows.days }
    : { error: true };

  // 9. Cash cycle.
  const cycle = ok(quarter) && ok(stock) && ok(receivables)
    ? { ...cashCycle({ stockCost: stock.ownedCost, cogs: quarter.cogs, sales: quarter.salesWithTax, receivables: receivables.total,
        payables: ok(suppliers) ? suppliers.total : null, purchases: quarter.purchases, days: quarter.days }),
        days: quarter.days, suppliers: ok(suppliers) ? suppliers : null }
    : { error: true };

  return { today, period, profit, forecast, worth, history: ok(history) ? history.rows : [], trend, goals, even, stock, cycle, ads, hst };
}

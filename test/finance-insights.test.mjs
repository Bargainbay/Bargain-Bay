// The owner view on the Financial dashboard.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { financialDashboard } from '../lib/analytics.js';
import { financeInsights, stockPicture, setFinanceTargets, saveNetWorth, worthNow } from '../lib/finance-insights.js';
import { ensureFinanceSchema } from '../lib/finance.js';
import {
  cashForecast, hstDueDate, isoDay, netWorth, projection, breakEven, ageStock, groupReturns, cashCycle, adReturn, platformOf
} from '../lib/finance-insights-math.js';
import { torontoToday } from '../lib/constants.js';

suite('owner view arithmetic');
test('the cash forecast adds up week by week and names the week the money runs out', () => {
  const r = cashForecast({ today: '2026-11-25', start: 1000, weeklyIn: 500, weeklyWages: 300, weeklyRunning: 200, weeklyDraws: 100,
    weeklyStock: 100, weeklyPaydown: 400, owedOld: 600, dated: [{ date: '2027-01-31', amount: 5000, label: 'Q4 HST' }] });
  equal(r.rows.length, 13);
  equal(r.rows[0].from, '2026-11-26'); equal(r.rows[0].out, 1100); equal(r.rows[0].closing, 400);
  equal(r.rows[1].paydown, 200, 'never pays more than is owed'); equal(r.rows[2].paydown, 0);
  equal(r.rows.filter((w) => w.oneOff === 5000).length, 1);
  equal(r.end, 1000 + 13 * 500 - 13 * 700 - 600 - 5000);
  equal(r.firstShort.week, 3);
  equal(r.lowest.closing, r.end);
});
test('HST is due at the end of the month after the quarter', () => {
  equal(hstDueDate(2026, 1), '2026-04-30'); equal(hstDueDate(2026, 3), '2026-10-31'); equal(hstDueDate(2026, 4), '2027-01-31');
});
test('tracker dates are read only when they are unambiguous', () => {
  equal(isoDay('2026-06-02'), '2026-06-02'); equal(isoDay('June 2, 2026'), '2026-06-02');
  equal(isoDay('02/06/2026'), null); equal(isoDay(''), null); equal(isoDay('soon'), null);
});
test('unknown is null, never zero', () => {
  equal(netWorth({ assets: [{ value: 10 }, { value: null }] }).complete, false);
  equal(breakEven({ costs: 100, days: 10, sales: 500, margin: null, cash: null }).breakEvenPerDay, null);
  equal(cashCycle({ stockCost: 100, cogs: 0, sales: 0, receivables: 0, payables: null, purchases: null, days: 30 }).cycle, null);
  equal(projection({ actual: 100, target: null, day: 10, daysInMonth: 30 }).pct, null);
});
test('break-even, targets and the cash cycle', () => {
  const b = breakEven({ costs: 2800, days: 28, sales: 5600, margin: 0.5, cash: 1000 });
  equal([b.costPerDay, b.breakEvenPerDay, b.salesPerDay, b.cushion, b.runwayDays], [100, 200, 200, 0, 10]);
  const p = projection({ actual: 1000, target: 4000, day: 10, daysInMonth: 30 });
  equal([p.projected, p.pct, p.perDayNeeded], [3000, 25, 150]);
  const c = cashCycle({ stockCost: 600, cogs: 900, sales: 1800, receivables: 100, payables: 200, purchases: 900, days: 90 });
  equal([c.stockDays, c.collectDays, c.payDays, c.cycle], [60, 5, 20, 45]);
});
test('stock is aged from arrival and returns count only units with both a cost and a price', () => {
  const units = [
    { lot: 'A', cost: 100, sold: true, soldPrice: 250, received: '2026-11-01', soldOn: '2026-11-11' },
    { lot: 'a', cost: 200, sold: true, soldPrice: null },
    { lot: 'A', cost: 50, sold: false, received: '2026-06-01' },
    { lot: 'B', cost: null, sold: false }
  ];
  const g = groupReturns(units, (u) => u.lot);
  equal([g[0].units, g[0].sold, g[0].profit, g[0].returnPct, g[0].avgDays, g[0].stockCost], [3, 2, 150, 150, 10, 50]);
  const ages = ageStock(units.filter((u) => !u.sold), '2026-11-25');
  equal(ages.find((a) => a.key === 'old').cost, 50); equal(ages.find((a) => a.key === 'unknown').noCost, 1);
  const s = stockPicture([...units, { sku: 'C', cost: 113, consigned: true, sold: false }], '2026-11-25');
  equal(s.ownedCost, 50); equal(s.consignedCost, 113); equal(s.oldest.length, 1);
});
test('ad spend in both places is not added twice', () => {
  equal(platformOf('Advertising - Facebook / Instagram'), 'meta'); equal(platformOf('Advertising FACEBK *ADS'), 'meta');
  equal(platformOf('Advertising Google Ads'), 'google'); equal(platformOf('Advertising flyers'), 'other');
  const r = adReturn({ bank: [{ platform: 'meta', amount: 100 }], typed: [{ platform: 'meta', amount: 80 }],
    sales: [{ source: 'marketplace', sales: 2, revenue: 900, profit: 400 }, { source: 'walk_in', sales: 1, revenue: 100, profit: 40 }] });
  const meta = r.rows.find((x) => x.key === 'meta');
  equal([meta.spend, meta.sales, meta.costPerSale, meta.profitPerDollar], [100, 2, 50, 4]);
  equal(r.other.length, 1);
});

suite('owner view against a database');
async function seed(client) {
  await ensureFinanceSchema();
  const { rows } = await client.query(`INSERT INTO orders (order_number,email,name,status,total,hst,subtotal,lead_source,created_at)
    VALUES ('BB-F1','a@b.ca','A','confirmed',1130,130,1000,'google',now()) RETURNING id`);
  await client.query(`INSERT INTO order_items (order_id, sku, title, price, kind, cost) VALUES ($1,'U1','Unit',1000,'unit',400)`, [rows[0].id]);
  const today = torontoToday();
  for (const [category, amount, source] of [['Wages', 200, 'plaid'], ['Rent / storage', 100, 'plaid'], ['Owner draw - Sai', 50, 'plaid'],
    ['Supplier Payment Secondshop', 300, 'plaid'], ['Advertising - Google', 20, 'plaid']]) {
    await client.query(`INSERT INTO expenses (incurred_on, category, vendor, amount, source) VALUES ($1,$2,'V',$3,$4)`, [today, category, amount, source]);
  }
}
test('WAGES MOVE TO THE LABOR LINE AND NET PROFIT IS UNCHANGED', async () => {
  const { client, done } = await withTestDb();
  try {
    await seed(client);
    const d = await financialDashboard('month');
    equal(d.kpis.labor, 200); equal(d.kpis.expenses, 120); equal(d.kpis.opex, 320);
    equal(d.kpis.netProfit, 600 - 320);
    assert(!d.expensesByCategory.some((e) => e.category === 'Wages'));
  } finally { done(); }
});
test('EVERY BLOCK LOADS (only the tracker, absent here, is reported as not known)', async () => {
  const { client, done } = await withTestDb();
  try {
    await seed(client);
    await setFinanceTargets({ revenue: '5000', gross: '', net: null });
    for (const period of ['month', 'all', 'last_week']) {
      const d = await financeInsights({ period, bankroll: { total: 5000, bankKnown: true, cashKnown: true, pay: { people: [{ balance: 40, thisWeek: 10 }] } } });
      for (const k of ['profit', 'forecast', 'trend', 'goals', 'even', 'ads', 'hst']) assert(d[k] && !d[k].error, `${k} failed for ${period}`);
      assert(d.stock.error, 'no tracker here');
      equal(d.worth.complete, false);
      equal(d.history.length, 0, 'an incomplete reading is never saved');
      const missing = d.worth.assets.concat(d.worth.liabilities).filter((x) => x.value == null).map((x) => x.label);
      equal(missing, ['Stock we own, at cost']);
    }
    const d = await financeInsights({ period: 'month', bankroll: null });
    equal(d.profit.kept, 280 - 50);
    equal(d.goals.targets.revenue, 5000);
    assert(d.forecast.error, 'no forecast without a bank figure');
    assert(d.trend.rows.length === 1 && d.trend.rows[0].net === 280);
  } finally { done(); }
});
test('net worth is saved once a month, only when every line is known', async () => {
  const { done } = await withTestDb();
  try {
    const full = worthNow({ bankroll: { total: 10, bankKnown: true, cashKnown: true }, receivables: { total: 5 }, stock: { ownedCost: 100 },
      suppliers: { total: 20 }, consignment: { total: 0 }, wages: { total: 1, thisWeek: 1 }, hst: { net: 3 }, credit: { total: 0 } });
    equal(full.net, 90);
    await saveNetWorth(full, '2026-11-01');
    const h = await saveNetWorth(full, '2026-11-20');
    equal(h.length, 1); equal(h[0].on, '2026-11-20');
  } finally { done(); }
});

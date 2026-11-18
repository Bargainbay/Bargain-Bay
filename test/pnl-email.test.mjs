import { suite, test, assert, equal } from './_harness.mjs';
import { thisWeek, renderReport, netBeforeOverhead, dailyReportDecision, torontoMidnightIso, isPeriodEnd, periodRange, groupWeeks } from '../lib/pnl-email.js';

suite('lib/pnl-email — the daily and weekly P&L emails');

test('the weekly report is the Monday-to-Sunday week containing the send day', () => {
  equal(thisWeek('2026-10-25'), { from: '2026-10-19', to: '2026-10-25' }); // Sunday night
  equal(thisWeek('2026-10-26'), { from: '2026-10-26', to: '2026-11-01' });
});

test('net before overhead adds the overhead back', () => {
  equal(netBeforeOverhead({ net: 6548.33, overhead: 419.65 }), 6967.98);
});

test('the email shows both nets and names what to check', () => {
  const row = { day: '2026-10-23', productProfit: 100, deliveryIncome: 50, marketplaceIncome: 0, deliveryCost: 900, staffWages: 0, overhead: 60, net: -810 };
  const totals = { ...row, daysMade: 0, daysLost: 1 };
  const { subject, html } = renderReport({ kind: 'daily', result: { rows: [row], totals, warnings: ['2 stops have no charge'], from: row.day, to: row.day } });
  assert(subject.includes('lost'));
  assert(html.includes('($750.00)'));
  assert(html.includes('($810.00)'));
  assert(html.includes('2 stops have no charge'));
});

import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { profitReport } from '../lib/dispatch-money.js';

test('a service call or pickup counts only when it carries a charge, and is never flagged as unpriced', async () => {
  const { done } = await withTestDb();
  try {
    const ins = (type, charge) => query(`INSERT INTO jobs (type, status, address, job_date, charge_amount) VALUES ($1,'done','1 St','2026-10-26',$2)`, [type, charge]);
    await ins('delivery', 100);
    await ins('service_call', 80);   // external, charged: counts
    await ins('service_call', null); // in-house: $0
    await ins('pickup', null);
    const p = await profitReport({ from: '2026-10-26', to: '2026-10-26' });
    equal(p.buckets[0].revenue, 180);
    equal(p.totals.unpricedRevenue, 0);
  } finally { await done(); }
});

test('the daily report waits for everyone to clock out, then forces at 12:01am', () => {
  const D = (hour, minute, open, alreadySent = null) => dailyReportDecision({ now: { date: '2026-11-17', hour, minute }, open, alreadySent });
  equal(D(21, 15, 2).action, 'wait');
  equal(D(22, 0, 0), { action: 'send', reportDay: '2026-11-17', forced: false });
  equal(D(0, 0, 1).action, 'wait');
  equal(D(0, 1, 1), { action: 'send', reportDay: '2026-11-16', forced: true });
  equal(D(0, 15, 0, '2026-11-16').action, 'skip');
  equal(D(14, 0, 0).action, 'skip');
  equal(torontoMidnightIso('2026-11-18'), '2026-11-18T05:00:00.000Z');
  equal(torontoMidnightIso('2026-07-02'), '2026-07-02T04:00:00.000Z');
});

test('weekly, monthly and quarterly reports only go on the last day of their period', () => {
  equal(isPeriodEnd('weekly', '2026-11-22'), true);   // Sunday
  equal(isPeriodEnd('weekly', '2026-11-21'), false);
  equal(isPeriodEnd('monthly', '2026-02-28'), true);
  equal(isPeriodEnd('monthly', '2026-11-29'), false);
  equal(isPeriodEnd('quarterly', '2026-09-30'), true);
  equal(isPeriodEnd('quarterly', '2026-10-31'), false);
  equal(periodRange('monthly', '2026-11-30'), { from: '2026-11-01', to: '2026-11-30' });
  equal(periodRange('quarterly', '2026-12-31'), { from: '2026-10-01', to: '2026-12-31' });
  equal(dailyReportDecision({ now: { date: '2026-11-18', hour: 0, minute: 5 }, open: 1, alreadySent: null, kind: 'monthly' }).action, 'skip');
  equal(dailyReportDecision({ now: { date: '2026-12-01', hour: 0, minute: 5 }, open: 1, alreadySent: null, kind: 'monthly' }),
    { action: 'send', reportDay: '2026-11-30', forced: true });
});

test('a long report folds its days into Monday-to-Sunday weeks that add up', () => {
  const g = groupWeeks([{ day: '2026-11-02', net: 10 }, { day: '2026-11-08', net: 5 }, { day: '2026-11-09', net: 1 }]);
  equal(g.length, 2); equal(g[0].net, 15); equal(g[1].net, 1);
});

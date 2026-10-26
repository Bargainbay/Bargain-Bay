import { suite, test, assert, equal } from './_harness.mjs';
import { lastFullWeek, renderReport, netBeforeOverhead } from '../lib/pnl-email.js';

suite('lib/pnl-email — the daily and weekly P&L emails');

test('the weekly report covers the last full Monday to Sunday', () => {
  equal(lastFullWeek('2026-10-26'), { from: '2026-10-19', to: '2026-10-25' }); // a Monday
  equal(lastFullWeek('2026-10-29'), { from: '2026-10-19', to: '2026-10-25' }); // a Thursday
  equal(lastFullWeek('2026-11-01'), { from: '2026-10-19', to: '2026-10-25' }); // a Sunday: that week is not over
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

test('service calls and pickups are $0 income even with a charge typed, and are not flagged as unpriced', async () => {
  const { done } = await withTestDb();
  try {
    const ins = (type, charge) => query(`INSERT INTO jobs (type, status, address, job_date, charge_amount) VALUES ($1,'done','1 St','2026-10-26',$2)`, [type, charge]);
    await ins('delivery', 100);
    await ins('service_call', 80);
    await ins('pickup', null);
    const p = await profitReport({ from: '2026-10-26', to: '2026-10-26' });
    equal(p.buckets[0].revenue, 100);
    equal(p.totals.unpricedRevenue, 0);
  } finally { await done(); }
});

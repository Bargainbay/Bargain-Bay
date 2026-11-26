// The four piles must add back to the sales, to the cent, whatever the day looks like.
import { suite, test, assert, equal } from './_harness.mjs';
import { splitDay, rollUp } from '../lib/cash-split-math.js';

suite('cash-split');

const day = (over) => ({ day: '2026-11-18', productCost: 800, productProfit: 450, deliveryIncome: 150, marketplaceIncome: 0, staffWages: 120,
  deliveryCost: 160, deliveryParts: { driverPay: 60, driverHours: 40, truck: 40, fuel: 20, other: 0 }, overhead: 100, missingCost: 0, ...over });

test('THE FOUR PILES ADD BACK TO THE SALES', () => {
  const s = splitDay(day());
  equal(s.sales, 1400); equal(s.product, 800); equal(s.labour, 220); equal(s.running, 160);
  equal(Math.round((s.product + s.labour + s.running + s.profit) * 100), Math.round(s.sales * 100));
  equal(s.profit, 220);
});

test('A DAY THAT COSTS MORE THAN IT TAKES IN IS A NEGATIVE PROFIT, NEVER HIDDEN', () => {
  const s = splitDay(day({ productProfit: 20, deliveryIncome: 0 }));
  assert(s.profit < 0, 'a loss shows as negative');
  const r = rollUp([day(), day({ day: '2026-11-19', productProfit: 20, deliveryIncome: 0 })]);
  equal(r.daysLost, 1);
});

test('THE RUNNING TOTAL IS CUMULATIVE AND STOCK STILL TO PUT BACK IS SOLD LESS BOUGHT', () => {
  const r = rollUp([day(), day({ day: '2026-11-19' })], 500);
  equal(r.rows[1].run.product, 1600); equal(r.total.profit, 440);
  equal(r.restock.toPutBack, 1100);
  equal(rollUp([day()], 1000).restock.toPutBack, -200);
  equal(rollUp([day()], null).restock, null);
});

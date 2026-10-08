// The date arithmetic behind the trend and comparison charts, and the daily feed.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { repDaily } from '../lib/analytics.js';
import { setReps } from '../lib/reps.js';
import {
  mondayOf, addMonths, presetRange, alignPair, bucketList, bucketStart, cumulative, totalsByRep, elapsedDays
} from '../lib/rep-periods.js';

// Thursday 2026-10-08.
const TODAY = '2026-10-08';

suite('rep-periods — ranges');
test('weeks start Monday and months roll over the year', () => {
  equal(mondayOf('2026-10-08'), '2026-10-05');
  equal(mondayOf('2026-10-04'), '2026-09-28', 'a Sunday belongs to the week before');
  equal(addMonths('2026-01-15', -1), '2025-12-01');
});
test('presets are half-open and land where people expect', () => {
  const w = presetRange('week', TODAY), lw = presetRange('last_week', TODAY);
  equal(w.from, '2026-10-05'); equal(w.to, '2026-10-12'); equal(lw.from, '2026-09-28'); equal(lw.to, w.from);
  const m = presetRange('month', TODAY), lm = presetRange('last_month', TODAY);
  equal(lm.from, '2026-09-01'); equal(lm.to, m.from); equal(m.to, '2026-11-01');
  const aug = presetRange('2026-08', TODAY);
  equal(aug.label, 'August 2026'); equal(aug.to, '2026-09-01');
  equal(presetRange('nonsense', TODAY), null);
});
test('THIS WEEK ON A THURSDAY IS NOT JUDGED AGAINST A FINISHED WEEK', () => {
  const { a, b, cut } = alignPair(presetRange('week', TODAY), presetRange('last_week', TODAY), TODAY, true);
  equal(cut, 4, 'Mon-Thu is four days');
  equal(a.to, '2026-10-09'); equal(b.to, '2026-10-02');
  const off = alignPair(presetRange('week', TODAY), presetRange('last_week', TODAY), TODAY, false);
  equal(off.cut, null); equal(off.b.to, '2026-10-05');
});
test('two finished months of different length are cut to the shorter when aligned', () => {
  const { a, b } = alignPair(presetRange('2026-08', TODAY), presetRange('2026-09', TODAY), TODAY, true);
  equal(a.to, '2026-08-31'); equal(b.to, '2026-10-01');
});
test('buckets: the last N, oldest first, ending on the current one', () => {
  const w = bucketList('week', 3, TODAY);
  equal(w.join(), '2026-09-21,2026-09-28,2026-10-05');
  equal(bucketList('month', 2, TODAY).join(), '2026-09-01,2026-10-01');
  equal(bucketStart('2026-10-08', 'week'), '2026-10-05');
});

suite('rep-periods — figures');
const rows = [
  { d: '2026-10-05', rep: 'a', sales: 1, revenue: 100, ownSales: 0, ownRevenue: 0 },
  { d: '2026-10-07', rep: 'a', sales: 2, revenue: 300, ownSales: 1, ownRevenue: 150 },
  { d: '2026-10-07', rep: 'b', sales: 1, revenue: 50, ownSales: 0, ownRevenue: 0 }
];
test('cumulative runs by day number and stops at today', () => {
  const r = presetRange('week', TODAY);
  const c = cumulative(rows, r, 'revenue', 'all', TODAY);
  equal(c.slice(0, 4).join(), '100,100,450,450');
  equal(c[4], null, 'Friday has not happened');
  equal(elapsedDays(r, TODAY), 4);
  equal(cumulative(rows, r, 'revenue', 'b', TODAY)[2], 50, 'one rep only');
});
test('totals by rep respect the range', () => {
  const t = totalsByRep(rows, presetRange('last_week', TODAY), 'revenue');
  equal(Object.keys(t).length, 0);
  equal(totalsByRep(rows, presetRange('week', TODAY), 'ownRevenue').a, 150);
});

suite('repDaily — the feed');
test('rows are per day per closing rep, pre-tax, with own-lead resolved', async () => {
  const { client, done } = await withTestDb();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())`);
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text');
    await setReps(['Roushi']);
    const add = (n, rep, lead, ago) => client.query(
      `INSERT INTO orders (order_number, email, name, status, total, hst, subtotal, sales_rep, lead_by, created_at)
       VALUES ($1,'a@b.ca','A','confirmed',1130,130,1000,$2,$3, now() - ($4 || ' days')::interval)`, [n, rep, lead, String(ago)]);
    await add('BB-R1', 'Roushi', 'roushi', 0);
    await add('BB-R2', 'Roushi', 'Sai', 0);
    await add('BB-R3', null, null, 0);
    const d = await repDaily({});
    const mine = d.rows.filter((r) => r.rep === 'roushi');
    equal(mine.reduce((s, r) => s + r.sales, 0), 2);
    equal(mine.reduce((s, r) => s + r.ownSales, 0), 1);
    equal(Math.round(mine.reduce((s, r) => s + r.revenue, 0)), 2000);
    assert(d.rows.some((r) => r.rep === ''), 'unassigned is its own row');
    assert(d.reps.some((r) => r.key === 'roushi'));
    let bad = false; try { await repDaily({ from: '2026-10-09', to: '2026-10-01' }); } catch { bad = true; }
    assert(bad, 'backwards range refused');
  } finally { done(); }
});

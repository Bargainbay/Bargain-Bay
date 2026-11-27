// Sales per day for a month, compared with other months; and the detail under today's sales.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { monthDays, repProfit } from '../lib/analytics.js';
import { daysIn, daySeries, runningTotal, sameDayCut, monthSummary, change, weekdayOf } from '../lib/month-sales.js';

async function fresh() {
  const db = await withTestDb();
  await db.client.query(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())`);
  await db.client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text');
  await db.client.query('ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text');
  return db;
}
let n = 0;
async function order(client, { at, total, hst, status = 'confirmed', lines = [] }) {
  n += 1;
  const { rows } = await client.query(
    `INSERT INTO orders (order_number,email,name,status,total,hst,subtotal,delivery_method,city,created_at)
     VALUES ($1,'a@b.ca','Pat',$2,$3,$4,$5,'delivery','Ajax',$6) RETURNING id`, [`BB-M${n}`, status, total, hst, total - hst, at]);
  for (const l of lines) {
    await client.query(`INSERT INTO order_items (order_id,sku,title,price,kind,cost) VALUES ($1,$2,$3,$4,$5,$6)`,
      [rows[0].id, l.sku ?? null, l.title, l.price, l.kind || 'unit', l.cost ?? null]);
  }
  return rows[0].id;
}

suite('month-by-day arithmetic');
test('a day still to come is empty, not zero', () => {
  equal(daysIn('2026-02'), 28); equal(weekdayOf('2026-11', 1), 'Sun');
  const s = daySeries([{ d: 2, sales: 1, revenue: 100 }], '2026-11', '2026-11-03', 'revenue');
  equal(s.length, 30); equal(s[0], 0); equal(s[1], 100); equal(s[2], 0); equal(s[3], null);
  equal(runningTotal(s).slice(0, 4), [0, 100, 100, null]);
});
test('a running month is compared to the same day of the others', () => {
  equal(sameDayCut(['2026-11', '2026-10'], '2026-11-10'), 10);
  equal(sameDayCut(['2026-09', '2026-10'], '2026-11-10'), null);
  const oct = [{ d: 5, sales: 1, revenue: 200 }, { d: 25, sales: 2, revenue: 900 }];
  const s = monthSummary(oct, '2026-10', '2026-11-10', 'revenue', 10);
  equal(s.total, 1100); equal(s.toCut, 200); equal(s.daysSold, 2); equal(s.best.day, 25);
  equal(change(300, 200), 50); equal(change(300, 0), null);
});

suite('month-by-day feed and today detail');
test('days are Toronto days, tax is split, cancelled orders are not sales, profit is for admins only', async () => {
  const { client, done } = await fresh();
  try {
    // 02:00 UTC on 1 Nov is still 31 Oct in Toronto.
    await order(client, { at: '2026-11-01T02:00:00Z', total: 113, hst: 13, lines: [{ sku: 'A', title: 'Fridge', price: 100, cost: 40 }] });
    await order(client, { at: '2026-10-05T16:00:00Z', total: 226, hst: 26, lines: [{ sku: 'B', title: 'Stove', price: 200, cost: 150 }] });
    await order(client, { at: '2026-10-05T17:00:00Z', total: 999, hst: 0, status: 'cancelled' });
    const a = await monthDays(['2026-10'], { profit: true });
    const days = a.months['2026-10'];
    equal(days.map((d) => d.d), [5, 31]);
    equal(days[0].revenue, 200); equal(days[0].revenueWithTax, 226); equal(days[0].gp, 50); equal(days[1].gp, 60);
    equal(a.first, '2026-10');
    const b = await monthDays(['2026-10', 'junk'], {});
    equal(b.selected, ['2026-10']);
    assert(!('gp' in b.months['2026-10'][0]), 'no profit without asking for it');
    let refused = false;
    await monthDays(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']).catch(() => { refused = true; });
    assert(refused, 'more than six months is refused');
    equal((await monthDays([])).selected.length, 2);
  } finally { done(); }
});
test('today’s sales carry their lines, cost, payment and customer, and the lines add up to the profit', async () => {
  const { client, done } = await fresh();
  try {
    const id = await order(client, { at: new Date().toISOString(), total: 1017, hst: 117, lines: [
      { sku: 'U1', title: 'Washer', price: 700, cost: 400 }, { sku: 'U2', title: 'Dryer', price: 200, cost: null },
      { title: 'Delivery', price: 50, kind: 'service' }, { title: 'Discount', price: -50, kind: 'discount' }] });
    const inv = await client.query(`INSERT INTO invoices (number,email,name,status,subtotal,hst,total,order_id) VALUES ('INV-T1','a@b.ca','Pat','partial',900,117,1017,$1) RETURNING id`, [id]);
    await client.query(`INSERT INTO invoice_payments (invoice_id,amount,method) VALUES ($1,500,'etransfer')`, [inv.rows[0].id]);
    const o = (await repProfit({ name: 'Owner' }, { all: true })).company.today.orders[0];
    equal(o.customer, 'Pat'); equal(o.city, 'Ajax'); equal(o.invoice, 'INV-T1'); equal(o.owing, 517); equal(o.methods, ['etransfer']);
    equal(o.cost, 400); equal(o.gp, 250); equal(o.missing, 1); equal(o.lines.length, 4);
    equal(o.lines.reduce((t, l) => t + (l.profit || 0), 0), o.gp);
    equal((await repProfit({ name: 'Owner' })).company, null);
  } finally { done(); }
});

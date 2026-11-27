// Net profit and the restock figure by day, as the owner's dashboard shows them.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { dayMoney, withNet } from '../lib/day-money.js';
import { dailyPnl } from '../lib/daily-pnl.js';
import { ordersOnDay, repProfit } from '../lib/analytics.js';
import { moneyDay, addUp } from '../lib/day-money-math.js';
import { recordConsignmentUnit } from '../lib/consignment.js';
import { torontoToday } from '../lib/constants.js';

suite('day money arithmetic');
test('NET IS GROSS PROFIT PLUS DELIVERIES LESS WAGES, TRUCK AND BILLS', () => {
  const m = moneyDay({ day: '2026-11-18', productCost: 800, vendorTax: 26, productProfit: 450, deliveryIncome: 150, marketplaceIncome: 10,
    staffWages: 120, deliveryCost: 160, deliveryParts: { driverPay: 60, driverHours: 40, truck: 40, fuel: 20, other: 0 }, overhead: 100, net: 230 });
  equal(m.restock, 826, 'the vendor is paid the tax too');
  equal(m.wages, 220); equal(m.truck, 60); equal(m.bills, 100);
  equal(m.net, 230);
  equal(Math.round((m.grossProfit + m.deliveryIn - m.wages - m.truck - m.bills) * 100) / 100, m.net);
  equal(addUp([m, m]).net, 460);
});

suite('day money feed');
test('each day agrees with the daily P&L, a drop-off unit is set aside tax included, and the cards carry it', async () => {
  const { client, done } = await withTestDb();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())`);
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text');
    await client.query('ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text');
    await recordConsignmentUnit({ sku: 'VD-1', vendor: 'Abi', cost: 113 });
    const { rows } = await client.query(
      `INSERT INTO orders (order_number,email,name,status,total,hst,subtotal,created_at) VALUES ('BB-D1','a@b.ca','Pat','confirmed',565,65,500,now()) RETURNING id`);
    await client.query(`INSERT INTO order_items (order_id,sku,title,price,kind,cost) VALUES ($1,'VD-1','Stove',300,'unit',113), ($1,'OWN-1','Fridge',200,'unit',50)`, [rows[0].id]);
    await client.query(`INSERT INTO recurring_costs (name,category,amount,frequency,starts_on) VALUES ('Rent','Rent',10,'daily','2026-01-01')`);
    const today = torontoToday();
    const m = await dayMoney({});
    equal(m.rows.length, 14);
    const d = m.rows[m.rows.length - 1];
    equal(d.day, today); equal(d.sales, 1); equal(d.revenue, 500); equal(d.revenueWithTax, 565);
    equal(d.grossProfit, 350); equal(d.restock, 163, '113 to the vendor plus 50'); equal(d.vendorTax, 13);
    equal(d.bills, 10); equal(d.net, 340);
    equal((await dailyPnl({ from: today, to: today })).rows[0].net, d.net);
    equal(m.rows[0].net, -10, 'a day with no sales still costs its bills');
    const orders = await ordersOnDay(today);
    equal(orders.length, 1); equal(orders[0].lines.length, 2); equal(orders[0].gp, 350);
    equal((await ordersOnDay('nonsense')).length, 0);
    const p = await withNet(await repProfit({ name: 'Owner' }, { all: true }));
    equal(p.company.today.net, 340); equal(p.company.today.restock, 163);
    assert(p.company.week.net <= 340 && p.company.month.restock === 163, 'week and month are carried too');
    const rep = await withNet(await repProfit({ name: 'Owner' }));
    equal(rep.company, null, 'a sales login gets no company figures');
  } finally { done(); }
});

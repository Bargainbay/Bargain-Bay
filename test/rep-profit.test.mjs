// A rep's gross profit for the day and the commission on it.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { repProfit } from '../lib/analytics.js';
import { setReps } from '../lib/reps.js';
import { repCommission, affiliateCommission, affiliateSaleState } from '../lib/commission-rules.js';

async function fresh() {
  const db = await withTestDb();
  await db.client.query(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())`);
  await db.client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text');
  await db.client.query('ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text');
  return db;
}
let n = 0;
// An order with one unit: sells at `price`, costs `cost`.
async function sale(client, { rep, price, cost, status = 'confirmed', discount = 0, credit = 0 }) {
  n += 1;
  const { rows } = await client.query(
    `INSERT INTO orders (order_number, email, name, status, total, hst, subtotal, sales_rep, discount, created_at)
     VALUES ($1,'a@b.ca','A',$2,$3,0,$3,$4,$5, now()) RETURNING id`, [`BB-P${n}`, status, price, rep ?? null, discount]);
  const id = rows[0].id;
  await client.query(`INSERT INTO order_items (order_id, sku, title, price, kind, cost) VALUES ($1,$2,'Unit',$3,'unit',$4)`, [id, `SKU${n}`, price, cost]);
  if (credit) await client.query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,NULL,'Trade-in',$2,'trade_in')`, [id, -credit]);
}

suite('commission rules');
test('a rep earns 10% of the day, and only once the day reaches $3,000', () => {
  equal(repCommission(0), 0);
  equal(repCommission(2999.99), 0);
  equal(repCommission(3000), 300);
  equal(repCommission(4200), 420);
});
test('an affiliate earns 5% of the goods: a $10,000 stove pays $500', () => {
  equal(affiliateCommission(10000), 500);
  equal(affiliateCommission(1234.56, 5), 61.73);
  equal(affiliateCommission(-5), 0);
});
test('an affiliate sale is void, waiting, held for the return window, then payable', () => {
  equal(affiliateSaleState({ status: 'cancelled', today: '2026-11-01' }).state, 'void');
  equal(affiliateSaleState({ status: 'refunded', deliveredOn: '2026-10-01', today: '2026-11-01' }).state, 'void');
  equal(affiliateSaleState({ status: 'confirmed', today: '2026-11-01' }).state, 'waiting');
  const hold = affiliateSaleState({ status: 'delivered', deliveredOn: '2026-10-20', today: '2026-10-30' });
  equal(hold.state, 'hold'); equal(hold.payableOn, '2026-11-03');
  equal(affiliateSaleState({ status: 'delivered', deliveredOn: '2026-10-20', today: '2026-11-03' }).state, 'payable');
});

suite('rep gross profit');
test('PROFIT IS PRICE LESS COST, CREDITED TO THE CLOSER, AND COMMISSION NEEDS $3,000', async () => {
  const { client, done } = await fresh();
  try {
    await setReps(['Roushi', 'Bishaka']);
    await sale(client, { rep: 'Roushi', price: 2500, cost: 1000 });   // 1500
    await sale(client, { rep: 'Roushi', price: 3000, cost: 1500 });   // 1500 -> Roushi 3000 today
    await sale(client, { rep: 'Bishaka', price: 1200, cost: 700 });   // 500
    await sale(client, { rep: 'Roushi', price: 900, cost: 100, status: 'cancelled' }); // not a sale
    const p = await repProfit({ name: 'Roushi', email: 'r@x.ca' }, { all: true });
    equal(p.me.name, 'Roushi');
    equal(p.me.today.gp, 3000);
    assert(p.me.today.hit, 'exactly $3,000 reaches the line');
    equal(p.me.today.commission, 300);
    equal(p.me.today.sales, 2);
    equal(p.me.month.commission, 300);
    const b = p.team.find((r) => r.name === 'Bishaka');
    equal(b.today.gp, 500); equal(b.today.commission, 0); equal(b.today.toGo, 2500);
  } finally { done(); }
});
test('a trade-in credit and a checkout coupon come off the profit; a missing cost counts as zero and is reported', async () => {
  const { client, done } = await fresh();
  try {
    await setReps(['Roushi']);
    await sale(client, { rep: 'Roushi', price: 2000, cost: 1000, credit: 200, discount: 50 }); // 1000 - 200 - 50
    n += 1;
    const { rows } = await client.query(`INSERT INTO orders (order_number,email,name,status,total,hst,subtotal,sales_rep,created_at) VALUES ($1,'a@b.ca','A','confirmed',500,0,500,'Roushi',now()) RETURNING id`, [`BB-P${n}`]);
    await client.query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,'NOCOST','Unit',500,'unit')`, [rows[0].id]);
    const p = await repProfit({ name: 'Roushi' });
    equal(p.me.today.gp, 750);
    equal(p.me.missingCost, 1);
    equal(p.team, null, 'the team table is not computed for a non-admin');
  } finally { done(); }
});
test('a login that matches no rep gets no card, never somebody else’s', async () => {
  const { client, done } = await fresh();
  try {
    await setReps(['Roushi']);
    await sale(client, { rep: 'Roushi', price: 5000, cost: 1000 });
    const p = await repProfit({ name: 'Stranger', email: 'nobody@x.ca' });
    equal(p.me, null);
  } finally { done(); }
});

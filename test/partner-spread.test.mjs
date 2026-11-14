// The "spread over member price" basis (Aljo, 2026-11-13): above member price is the partner's; at member price, a share of profit.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertCustomer } from '../lib/customers.js';
import { savePartner, partnerReport, spreadCommission, setClientPartner } from '../lib/referral-partners.js';

const member = (m) => (k) => (k in m ? m[k] : null);
suite('partner spread basis');
test('a sale above member price pays the whole spread, after the coupon', () => {
  // $1,000 fridge, member price $550, cost $500, 5% coupon ($50): customer paid $950, spread $400.
  const r = spreadCommission([{ sku: 'A', price: 1000, cost: 500 }], 50, member({ A: 550 }), 0.10);
  equal(Math.round(r.commission), 400); equal(Math.round(r.spread), 400);
});
test('a sale at member price pays the profit share instead', () => {
  // sold at $550, cost $500: profit $50, 10% = $5, no spread
  const r = spreadCommission([{ sku: 'A', price: 550, cost: 500 }], 0, member({ A: 550 }), 0.10);
  equal(r.commission.toFixed(2), '5.00'); equal(r.spread, 0);
});
test('never more than the unit made', () => {
  const r = spreadCommission([{ sku: 'A', price: 1000, cost: 900 }], 0, member({ A: 550 }), 0.10);
  equal(Math.round(r.commission), 100);
});
test('mixed lines: the one above member price pays the spread, the one at it pays the profit share', () => {
  const r = spreadCommission([{ sku: 'A', price: 1000, cost: 500 }, { sku: 'B', price: 550, cost: 500 }], 0, member({ A: 550, B: 550 }), 0.10);
  equal(r.commission.toFixed(2), '455.00');
});
test('an unknown member price pays the profit share, never a made-up spread', () => {
  const r = spreadCommission([{ sku: 'X', price: 1000, cost: 500 }], 0, member({}), 0.10);
  equal(r.commission.toFixed(2), '50.00'); equal(r.spread, 0);
});


test('end to end: a coded sale pays the spread over the live member price, a member-price sale pays 10% of profit', async () => {
  const { done } = await withTestDb();
  try {
    const ORG = 'aljo@aljo.ca';
    await savePartner({ email: ORG, name: 'Aljo', pct: 15, basis: 'spread', leadPct: 10 }, 'owner@x.ca');
    await query(`INSERT INTO products (sku, make, model, title, category, condition, price, compare_at, cost, active) VALUES ('S1','LG','M1','Fridge','Refrigerator','Open Box',1000,1000,500,true), ('S2','LG','M2','Fridge','Refrigerator','Open Box',1000,1000,500,true)`);
    const c = await upsertCustomer({ email: 'buyer@x.ca', name: 'Buyer' });
    await setClientPartner(c, ORG, 'client', 'owner@x.ca');
    const mk = async (no, sku, price, disc) => {
      const { rows } = await query(`INSERT INTO orders (order_number, email, name, status, subtotal, discount, total, hst) VALUES ($1,'buyer@x.ca','C','confirmed',$2,$3,$2,0) RETURNING id`, [no, price, disc]);
      await query(`INSERT INTO order_items (order_id, sku, title, price, cost, kind) VALUES ($1,$2,'Fridge',$3,500,'unit')`, [rows[0].id, sku, price]);
    };
    await mk('BB-S1', 'S1', 1000, 50);   // customer paid 950; member price is 700 (cost + $200 floor) -> spread 250
    await mk('BB-S2', 'S2', 700, 0);     // sold at member price: profit 200 -> 10% = 20
    const r = await partnerReport(ORG);
    const o = r.clients[0].orders;
    equal(o.find((x) => x.number === 'BB-S1').commission, 250);
    equal(o.find((x) => x.number === 'BB-S2').commission, 20);
    equal(r.partner.basis, 'spread');
  } finally { done(); }
});

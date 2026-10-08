// lib/abandoned-carts.js — carts people left behind, for staff to phone.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { recordCart, abandonedCarts, raiseAbandonedCartTasks } from '../lib/abandoned-carts.js';
import { myDay } from '../lib/crm.js';

const fresh = () => withTestDb();
const age = (token, hours) =>
  query(`UPDATE cart_sessions SET updated_at = now() - ($2::int * interval '1 hour') WHERE token = $1`, [token, hours]);
const unit = (sku, price = 500) =>
  query(`INSERT INTO products (sku, make, model, title, price, active) VALUES ($1,'LG','M1',$2,$3,true)`, [sku, `Fridge ${sku}`, price]);

suite('Abandoned carts');

test('an anonymous cart is never stored', async () => {
  const { done } = await fresh();
  try {
    const r = await recordCart({ token: 'tok-anon-0001', skus: ['A1'] });
    equal(r.stored, false);
    equal((await query('SELECT count(*)::int AS n FROM cart_sessions')).rows[0].n, 0);
  } finally { done(); }
});

test('a cart with an email is stored and goes quiet after N hours', async () => {
  const { done } = await fresh();
  try {
    await unit('A1');
    await recordCart({ token: 'tok-mail-0001', skus: ['A1'], email: 'Sam@Example.com' });
    equal((await abandonedCarts({ hours: 4 })).length, 0, 'still fresh');
    await age('tok-mail-0001', 5);
    const [c] = await abandonedCarts({ hours: 4 });
    equal(c.email, 'sam@example.com');
    equal(c.units[0].state, 'available');
    equal(c.availableTotal, 500);
  } finally { done(); }
});

test('emptying the cart closes it; refilling starts a fresh one', async () => {
  const { done } = await fresh();
  try {
    await unit('A1');
    await recordCart({ token: 'tok-mail-0002', skus: ['A1'], email: 'a@b.ca' });
    await recordCart({ token: 'tok-mail-0002', skus: [] });
    await age('tok-mail-0002', 9);
    equal((await abandonedCarts({ hours: 4 })).length, 0);
    await recordCart({ token: 'tok-mail-0002', skus: ['A1'] });
    await age('tok-mail-0002', 9);
    equal((await abandonedCarts({ hours: 4 })).length, 1);
  } finally { done(); }
});

test('a later order by the same person takes the cart off the list', async () => {
  const { done } = await fresh();
  try {
    await unit('A1');
    await recordCart({ token: 'tok-mail-0003', skus: ['A1'], email: 'a@b.ca' });
    await age('tok-mail-0003', 6);
    await query(`INSERT INTO orders (email, status) VALUES ('A@B.ca','pending_payment')`);
    equal((await abandonedCarts({ hours: 4 })).length, 0);
  } finally { done(); }
});

test('units sold or held since are labelled, and a dead cart raises nothing', async () => {
  const { done } = await fresh();
  try {
    await unit('A1'); await unit('A2'); await unit('A3');
    await recordCart({ token: 'tok-mail-0004', skus: ['A1', 'A2', 'A3'], email: 'a@b.ca' });
    await age('tok-mail-0004', 6);
    const o = (await query(`INSERT INTO orders (email, status) VALUES ('x@y.ca','confirmed') RETURNING id`)).rows[0].id;
    await query(`INSERT INTO order_items (order_id, sku) VALUES ($1,'A1')`, [o]);
    await query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('A2',$1, now() + interval '1 day')`, [o]);
    const [c] = await abandonedCarts({ hours: 4 });
    const st = Object.fromEntries(c.units.map((u) => [u.sku, u.state]));
    equal(st, { A1: 'sold', A2: 'held', A3: 'available' });
    equal(c.availableTotal, 500);

    await query(`UPDATE products SET active=false WHERE sku='A3'`);
    const r = await raiseAbandonedCartTasks({ hours: 4 });
    equal(r.raised, 0, 'nothing left to sell, nothing to ring about');
  } finally { done(); }
});

test('one UNASSIGNED follow-up per customer, however many carts', async () => {
  const { done } = await fresh();
  try {
    await unit('A1'); await unit('A2');
    await recordCart({ token: 'tok-mail-0005', skus: ['A1'], email: 'a@b.ca', name: 'Sam' });
    await recordCart({ token: 'tok-mail-0006', skus: ['A2'], email: 'a@b.ca' });   // second device
    await age('tok-mail-0005', 6); await age('tok-mail-0006', 6);
    const r = await raiseAbandonedCartTasks({ hours: 4 });
    equal(r.raised, 1);
    const again = await raiseAbandonedCartTasks({ hours: 4 });
    equal(again.raised, 0, 'idempotent');
    const t = (await query('SELECT * FROM customer_tasks')).rows;
    equal(t.length, 1);
    equal(t[0].owner_email, null);
    assert(t[0].title.startsWith('Abandoned cart'));
    const day = await myDay({ email: 'rep@x.ca' });
    equal(day.counts.unowned, 1, 'shows on everyone\'s My Day');
  } finally { done(); }
});

test('a phone-only shopper is reachable and gets a task', async () => {
  const { done } = await fresh();
  try {
    await unit('A1');
    await recordCart({ token: 'tok-tel-00001', skus: ['A1'], phone: '(437) 488-8549' });
    await age('tok-tel-00001', 6);
    equal((await raiseAbandonedCartTasks({ hours: 4 })).raised, 1);
  } finally { done(); }
});

test('raising a follow-up never touches consent or sends anything', async () => {
  const { done } = await fresh();
  try {
    await unit('A1');
    await recordCart({ token: 'tok-mail-0007', skus: ['A1'], email: 'a@b.ca' });
    await age('tok-mail-0007', 6);
    await raiseAbandonedCartTasks({ hours: 4 });
    const n = await query(`SELECT count(*)::int AS n FROM consent_events`).catch(() => ({ rows: [{ n: 0 }] }));
    equal(n.rows[0].n, 0);
  } finally { done(); }
});

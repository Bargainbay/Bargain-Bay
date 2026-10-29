// Package deals: the price reaches an order as a discount against the live unit prices,
// only when the whole package is in the cart, and never below what the units can spare.
import { suite, test, equal, assert } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { saveBundle, bestBundleDiscount, liveBundles, setBundleActive } from '../lib/bundles.js';

suite('lib/bundles');

test('a package gives the shopper the gap, only when every unit is in the cart', async () => {
  const { client, done } = await withTestDb();
  try {
    for (const [id, cost] of [['W1', 400], ['D1', 300], ['F1', 900]]) {
      await client.query('INSERT INTO products (sku, make, model, price, cost, active) VALUES ($1,$2,$3,$4,$5,true)', [id, 'X', id, 1000, cost]);
    }
    const id = await saveBundle({ title: 'Laundry pair', price: 1500, skus: ['W1', 'D1'] }, 't@x');
    const unit = (u, price, cost) => ({ id: u, price, cost });
    const items = [unit('W1', 1000, 400), unit('D1', 1000, 300), unit('F1', 1000, 900)];
    const priced = new Map(items.map((u) => [u.id, { price: u.price }]));

    equal((await bestBundleDiscount(items, priced)).discount, 500);
    equal(await bestBundleDiscount([items[0], items[2]], priced), null, 'half a package earns nothing');

    // A unit already priced below the package (member / clearance) leaves no gap.
    const cheap = new Map([['W1', { price: 700 }], ['D1', { price: 700 }]]);
    equal(await bestBundleDiscount(items.slice(0, 2), cheap), null);

    // Switched off, it is not applied.
    await setBundleActive(id, false);
    equal(await bestBundleDiscount(items, priced), null);
  } finally { done(); }
});

test('refuses a package under cost, and one with fewer than two units', async () => {
  const { client, done } = await withTestDb();
  try {
    for (const [id, cost] of [['W1', 400], ['D1', 300]]) {
      await client.query('INSERT INTO products (sku, make, model, price, cost, active) VALUES ($1,$2,$3,$4,$5,true)', [id, 'X', id, 1000, cost]);
    }
    let msg = '';
    try { await saveBundle({ title: 'Loss', price: 600, skus: ['W1', 'D1'] }); } catch (e) { msg = e.message; }
    assert(/floor/.test(msg), msg);
    msg = '';
    try { await saveBundle({ title: 'One', price: 900, skus: ['W1'] }); } catch (e) { msg = e.message; }
    assert(/two units/.test(msg), msg);
  } finally { done(); }
});

test('the storefront lists a package only while all its units are for sale and it saves money', async () => {
  const { client, done } = await withTestDb();
  try {
    for (const id of ['W1', 'D1']) await client.query('INSERT INTO products (sku, make, model, price, cost, active) VALUES ($1,$2,$3,$4,$5,true)', [id, 'X', id, 1000, 100]);
    await saveBundle({ title: 'Pair', price: 1800, skus: ['W1', 'D1'] });
    const u = (id, price) => ({ id, price });
    equal((await liveBundles([u('W1', 1000), u('D1', 1000)])).length, 1);
    equal((await liveBundles([u('W1', 1000)])).length, 0, 'one sold: package gone');
    equal((await liveBundles([u('W1', 800), u('D1', 800)])).length, 0, 'no saving: not shown');
  } finally { done(); }
});

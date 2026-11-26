// Meta is told about a website sale only once it is paid, once, and never about
// an order nobody paid for.
import assert from 'node:assert/strict';
import { suite, test } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { recordWebOrderForMeta, sendPaidPurchases, purchaseEventTime } from '../lib/meta-purchases.js';

const req = { cookies: { get: (n) => ({ value: n === '_fbp' ? 'fb.1.abc' : 'fb.1.click' }) } };

async function order(n, { status = 'pending_payment', method = 'etransfer', web = true, invoice = 'open', paid = 0 } = {}) {
  const { rows } = await query(
    `INSERT INTO orders (order_number, email, name, phone, delivery_method, status, subtotal, hst, total, payment_method)
     VALUES ($1, 'Buyer@Example.com', 'B', '416 555 0100', 'pickup', $2, 100, 13, 113, $3) RETURNING id`,
    [n, status, method]);
  const id = rows[0].id;
  await query(`INSERT INTO order_items (order_id, sku, title, price) VALUES ($1, 'SKU-1', 'Fridge', 100)`, [id]);
  if (invoice) {
    const inv = await query(
      `INSERT INTO invoices (number, order_id, email, name, status, subtotal, hst, total, channel)
       VALUES ($1, $2, 'buyer@example.com', 'B', $3, 100, 13, 113, 'web') RETURNING id`,
      [`INV-${n}`, id, invoice]);
    if (paid) await query('INSERT INTO invoice_payments (invoice_id, amount, method) VALUES ($1, $2, $3)', [inv.rows[0].id, paid, 'Cash']);
  }
  if (web) await recordWebOrderForMeta(id, req);
  return id;
}

suite('lib/meta-purchases — only paid orders count');

test('only paid website orders are sent, and only once', async () => {
  const { done } = await withTestDb();
  try {
    const waiting = await order('BB-1');
    await order('BB-2', { status: 'cancelled', invoice: 'void' });
    await order('BB-3', { status: 'confirmed', invoice: 'paid', web: false });       // staff sale
    await order('BB-4', { status: 'ready', method: 'in_person', invoice: 'paid' });  // no money yet
    await order('BB-5', { status: 'pending_payment', invoice: 'partial', paid: 20 });
    await order('BB-6', { status: 'confirmed', invoice: 'paid', paid: 113 });
    await order('BB-7', { status: 'delivered', method: 'in_person', invoice: 'paid' });

    const events = [];
    const send = async (e) => { events.push(e); return { ok: true }; };
    assert.equal((await sendPaidPurchases({ send, ready: true })).sent, 2);
    assert.deepEqual(events.map((e) => e.event_id), ['purchase-BB-6', 'purchase-BB-7']);

    const e = events[0];
    assert.equal(e.event_name, 'Purchase');
    assert.equal(e.custom_data.value, 113);
    assert.deepEqual(e.custom_data.content_ids, ['SKU-1']);
    assert.equal(e.user_data.fbp, 'fb.1.abc');
    assert.equal(e.user_data.fbc, 'fb.1.click');
    assert.match(e.user_data.em[0], /^[0-9a-f]{64}$/);
    assert.match(e.user_data.ph[0], /^[0-9a-f]{64}$/);

    // The money lands later: sent then, and nothing is repeated.
    await query(`UPDATE orders SET status = 'confirmed' WHERE id = $1`, [waiting]);
    await query(`UPDATE invoices SET status = 'paid' WHERE order_id = $1`, [waiting]);
    events.length = 0;
    await sendPaidPurchases({ send, ready: true });
    await sendPaidPurchases({ send, ready: true });
    assert.deepEqual(events.map((x) => x.event_id), ['purchase-BB-1']);
  } finally { done(); }
});

test('a refused send is reported and tried again', async () => {
  const { done } = await withTestDb();
  try {
    await order('BB-9', { status: 'confirmed', invoice: 'paid' });
    const r = await sendPaidPurchases({ send: async () => ({ ok: false, error: 'Meta answered 400' }), ready: true });
    assert.equal(r.sent, 0);
    assert.equal(r.failed[0].order, 'BB-9');
    assert.equal((await sendPaidPurchases({ send: async () => ({ ok: true }), ready: true })).sent, 1);
  } finally { done(); }
});

test('event time is the order time while Meta still accepts it', () => {
  const now = Date.UTC(2026, 10, 25);
  assert.equal(purchaseEventTime(new Date(now - 3600e3), now), (now - 3600e3) / 1000);
  assert.equal(purchaseEventTime(new Date(now - 9 * 86400e3), now), now / 1000);
});

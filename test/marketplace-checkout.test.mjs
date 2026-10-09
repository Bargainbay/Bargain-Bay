// The real /api/checkout route, end to end against a real database, with a vendor unit in the cart.
// Card payments are off, so this is the offline (e-transfer) path the shop actually runs.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { createApplication, decideApplication } from '../lib/vendors.js';
import { POST } from '../app/api/checkout/route.js';
import { confirmVendorOrders } from '../lib/vendor-orders.js';
import { updateOrderStatus } from '../lib/orders.js';
import { saveCoupon } from '../lib/coupons.js';

const KEYS = ['MARKETPLACE_STOREFRONT', 'MARKETPLACE_ORDERING', 'MARKETPLACE_BOOKS_READY'];
async function withFlags(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
// ONE database for this whole file. The checkout route's runtime-DDL helpers (ensureAttributionColumns and
// friends) memoise "done" in module scope, so a second FRESH database would never get their columns.
// Real deployments have one database; the file shares one too, and each test seeds its own vendor.
let shared = null;
const db = () => (shared ||= withTestDb());
let ip = 0;
let seeded = 0;
const call = (body) => POST(new Request('http://localhost/api/checkout', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip}` },
  body: JSON.stringify({ email: `buyer${ip}@gmail.com`, name: 'Buyer', phone: '4165550100', paymentMethod: 'etransfer', ...body })
}));
const json = async (res) => ({ status: res.status, ...(await res.json()) });

async function seed() {
  seeded += 1;
  const v = await createApplication({ legalName: `Alpha${seeded}`, contactEmail: `alpha${seeded}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  const mk = async (sku, lane) => (await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working)
     VALUES ($1,$2,$3,'live','Refrigerator','Whirlpool','WRF535','Refurbished','Vendor fridge',1000,12,280,36,34,70,true) RETURNING id`, [sku, v.id, lane])).rows[0].id;
  await mk(`MP-${v.id}-0001`, 'A'); await mk(`MP-${v.id}-0002`, 'C');
  const own = `OWN-${seeded}`;
  await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, active) VALUES ($1,'LG','LRMVS','Refrigerator','Our fridge','Refurbished',600,300,true)`, [own]);
  return { v, a: `MP-${v.id}-0001`, c: `MP-${v.id}-0002`, own };
}

suite('/api/checkout — a vendor unit in the cart');

test('with ordering CLOSED a vendor unit is simply not in the catalogue, and our own stock still sells', async () => {
  await db();
  try {
    const s = await seed();
    await withFlags({ MARKETPLACE_STOREFRONT: '1' }, async () => {
      const r = await json(await call({ skus: [s.a], deliveryMethod: 'delivery', address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1' }));
      equal(r.status, 409);
      const own = await json(await call({ skus: [s.own], deliveryMethod: 'pickup' }));
      equal(own.status, 200); assert(own.orderNumber, 'an ordinary order is unaffected');
      equal((await query('SELECT count(*)::int AS n FROM vendor_orders WHERE vendor_id = $1', [s.v.id])).rows[0].n, 0);
    });
  } finally { /* the shared database is released by the last test */ }
});

test('with ordering OPEN: one order, one fee per shipment, vendor orders written, nothing sold or started until payment', async () => {
  await db();
  try {
    const s = await seed();
    await withFlags({ MARKETPLACE_STOREFRONT: '1', MARKETPLACE_ORDERING: '1', MARKETPLACE_BOOKS_READY: '1' }, async () => {
      const r = await json(await call({ skus: [s.own, s.a, s.c], deliveryMethod: 'delivery', address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1' }));
      equal(r.status, 200);
      const o = (await query('SELECT * FROM orders WHERE order_number = $1', [r.orderNumber])).rows[0];
      // goods 600 + 1000 + 1000; delivery = 2 shipments (ours + the Lane C seller) at the flat fee
      const fee = Number(o.total) - Number(o.subtotal) - Number(o.hst);
      equal(Number(o.subtotal), 2600); equal(Math.round(fee * 100), 2 * 7900);
      equal(o.status, 'pending_payment');
      const vos = (await query('SELECT lane, status, item_cents, lane_c_delivery_cents FROM vendor_orders WHERE order_id = $1 ORDER BY lane', [o.id])).rows;
      equal(vos.map((x) => x.lane).join(), 'A,C'); assert(vos.every((x) => x.status === 'awaiting_payment'), 'clocks not started');
      equal(Number(vos[1].lane_c_delivery_cents), 6320);
      const items = (await query('SELECT sku, vendor_id FROM order_items WHERE order_id = $1 ORDER BY sku', [o.id])).rows;
      equal(items.filter((i) => i.vendor_id).length, 2);
      equal((await query(`SELECT count(*)::int AS n FROM marketplace_listings WHERE status = 'live' AND vendor_id = $1`, [s.v.id])).rows[0].n, 2);   // still on sale until paid
      const inv = (await query(`SELECT i.total FROM invoices i WHERE i.order_id = $1`, [o.id])).rows;
      equal(inv.length, 1); equal(Number(inv[0].total), Number(o.total));          // the web invoice carries the same figure
      // the buyer cannot grab the same units twice
      const again = await json(await call({ skus: [s.a], deliveryMethod: 'delivery', address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1' }));
      equal(again.status, 409);
      // we confirm the e-transfer: the clocks start and the units are sold
      await updateOrderStatus(o.id, 'confirmed');
      const after = (await query('SELECT status, accept_by FROM vendor_orders WHERE order_id = $1', [o.id])).rows;
      assert(after.every((x) => x.status === 'awaiting_accept' && x.accept_by), 'both clocks running');
      equal((await query(`SELECT count(*)::int AS n FROM marketplace_listings WHERE status = 'sold' AND vendor_id = $1`, [s.v.id])).rows[0].n, 2);
      void confirmVendorOrders;
    });
  } finally { /* the shared database is released by the last test */ }
});

test('warehouse pickup is refused for a unit that is not in our building', async () => {
  await db();
  try {
    const s = await seed();
    await withFlags({ MARKETPLACE_STOREFRONT: '1', MARKETPLACE_ORDERING: '1', MARKETPLACE_BOOKS_READY: '1' }, async () => {
      const r = await json(await call({ skus: [s.c], deliveryMethod: 'pickup' }));
      equal(r.status, 400); assert(/delivery/.test(r.error), r.error);
      const a = await json(await call({ skus: [s.a], deliveryMethod: 'pickup' }));
      equal(a.status, 200);                                                          // Lane A is in our warehouse
    });
  } finally { /* the shared database is released by the last test */ }
});

test('our promo codes never discount a seller\'s unit', async () => {
  await db();
  try {
    const s = await seed();
    await withFlags({ MARKETPLACE_STOREFRONT: '1', MARKETPLACE_ORDERING: '1', MARKETPLACE_BOOKS_READY: '1' }, async () => {
      await saveCoupon({ code: `TEN${s.v.id}`, kind: 'percent', value: 10, active: true });
      const real = (await query('SELECT count(*)::int AS n FROM coupons')).rows[0].n;
      assert(real >= 1, 'the code really exists');
      // a code on a cart of ONLY a seller's unit gets nothing…
      const only = await json(await call({ skus: [s.a], deliveryMethod: 'delivery', address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1', couponCode: `TEN${s.v.id}` }));
      equal(only.status, 200);
      equal(Number((await query('SELECT discount FROM orders WHERE order_number = $1', [only.orderNumber])).rows[0].discount), 0);
      // …and in a mixed cart it discounts OUR unit alone: 10% of $600, not of $1,600.
      const mixed = await json(await call({ skus: [s.own, s.c], deliveryMethod: 'delivery', address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1', couponCode: `TEN${s.v.id}` }));
      equal(mixed.status, 200);
      equal(Number((await query('SELECT discount FROM orders WHERE order_number = $1', [mixed.orderNumber])).rows[0].discount), 60);
    });
  } finally { /* the shared database is released by the last test */ }
  shared?.then((x) => x.done());
});

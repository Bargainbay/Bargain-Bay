// The claim-photo ROUTES, called as real handlers with real sessions against a real database: the
// permissions, the upload (image decoded and re-encoded, EXIF/GPS gone), and tenant isolation on the way
// back out. Blob storage is the in-memory stand-in (test/stubs/vercel-blob.mjs); the live store itself is
// the only thing this cannot exercise.
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { __blobKeys, __blobBytes } from './stubs/vercel-blob.mjs';
import { query, withTransaction } from '../lib/db.js';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth.js';
import { createApplication, decideApplication, grantVendorUser } from '../lib/vendors.js';
import { createVendorOrdersTx, confirmVendorOrders, acceptVendorOrder, markVendorOrderReady, deliverVendorOrder } from '../lib/vendor-orders.js';
import { openClaim, listVendorClaims } from '../lib/warranty-claims.js';
import * as adminPhotos from '../app/api/admin/marketplace/claims/photos/route.js';
import * as vendorPhotos from '../app/api/vendor/claims/photos/route.js';
import * as adminClaims from '../app/api/admin/marketplace/claims/route.js';
import * as vendorClaims from '../app/api/vendor/claims/route.js';
import * as ledgerRoute from '../app/api/admin/marketplace/ledger/route.js';
import { vendorBalance } from '../lib/vendor-ledger.js';

process.env.ADMIN_EMAILS = 'boss@example.test';
process.env.SALES_EMAILS = 'rep@example.test';
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'photos-test-secret';
process.env.BLOB_READ_WRITE_TOKEN = 'test-token';

const T0 = new Date();
async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `${name.toLowerCase()}-user@example.com`, role: 'owner', by: 's' });
  await query('UPDATE vendors SET tier = 1 WHERE id = $1', [v.id]);
  return v;
}
let n = 0;
async function deliveredClaim(v) {
  n += 1; const sku = `MP-${v.id}-${String(n).padStart(4, '0')}`;
  await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working)
     VALUES ($1,$2,'A','live','Refrigerator','Whirlpool','WRF535','Refurbished','A fridge',1000,12,60,24,24,34,true)`, [sku, v.id]);
  const { rows } = await query(`INSERT INTO orders (email, name, delivery_method, status, subtotal, hst, total) VALUES ('c@example.com','C','delivery','pending_payment',0,0,0) RETURNING id`);
  const id = rows[0].id; await query(`UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1`, [id]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,'A fridge',1000,'unit')`, [id, sku]);
  const unit = { id: sku, marketplace: true, lane: 'A', vendor: { id: v.id }, price: 1000, title: 'A fridge' };
  await withTransaction((c) => createVendorOrdersTx(c, { orderId: id, orderNumber: `BB-${1000 + id}`, units: [unit], deliveryMethod: 'delivery', feeCents: 7900 }));
  await confirmVendorOrders(id, { now: T0 });
  const vo = (await query('SELECT * FROM vendor_orders WHERE order_id = $1', [id])).rows[0];
  await acceptVendorOrder(v.id, vo.id, { insurance: 'declined', now: T0 }); await markVendorOrderReady(v.id, vo.id, { now: T0 });
  await deliverVendorOrder(vo.id, { deliveredAt: T0 });
  return openClaim({ vendorOrderId: vo.id, description: 'The compressor does not start at all', by: 'staff@x', now: T0 });
}

// a real JPEG with EXIF (a copyright string, standing in for GPS) that the pipeline must strip
const photo = () => sharp({ create: { width: 1400, height: 1000, channels: 3, background: { r: 180, g: 90, b: 40 } } })
  .withMetadata({ exif: { IFD0: { Copyright: 'SECRET-LOCATION-DATA' } } }).jpeg().toBuffer();
const keys = () => new Set(__blobKeys());
const added = (before) => [...keys()].filter((k) => !before.has(k));
const as = async (email, id) => __setTestCookies(email ? { [SESSION_COOKIE]: await createSessionToken({ id, email, name: email, token_version: 0 }) } : {});
function upload(url, claimId, buf, name = 'p.jpg', type = 'image/jpeg') {
  const fd = new FormData();
  fd.append('claimId', String(claimId));
  fd.append('photos', new Blob([buf], { type }), name);
  return new NextRequest(url, { method: 'POST', body: fd });
}
const A = 'http://localhost/api/admin/marketplace/claims/photos';
const V = 'http://localhost/api/vendor/claims/photos';

suite('claim photo routes — real handlers, real sessions');

test('PERMISSIONS: nobody and a plain customer are refused on every method of both routes', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const c = await deliveredClaim(v); const buf = await photo(); const before = keys();
    for (const who of [[null, 0], ['shopper@example.test', 7]]) {
      await as(...who);
      equal((await adminPhotos.POST(upload(A, c.id, buf))).status, 403);
      equal((await adminPhotos.GET(new NextRequest(`${A}?id=1`))).status, 403);
      equal((await vendorPhotos.POST(upload(V, c.id, buf))).status, 403);
      equal((await vendorPhotos.GET(new NextRequest(`${V}?id=1`))).status, 403);
    }
    equal(added(before).length, 0);   // nothing was stored
  } finally { __setTestCookies(null); done(); }
});

test('a rep uploads the fault, the image is re-encoded with its EXIF gone, and the seller can see it', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const c = await deliveredClaim(v); const buf = await photo();
    assert(buf.includes(Buffer.from('SECRET-LOCATION-DATA')), 'the test image really carries the metadata');
    const before = keys();
    await as('rep@example.test', 5);                                              // staff, not admin: opening/adding is the customer's sale
    const res = await adminPhotos.POST(upload(A, c.id, buf));
    equal(res.status, 200); const j = await res.json(); assert(j.ok && j.saved.length === 1 && !j.refused.length, JSON.stringify(j));
    const key = added(before)[0];
    assert(key, 'stored under the claim');
    const stored = __blobBytes(key);
    assert(stored.slice(0, 2).toString('hex') === 'ffd8', 'a JPEG');
    assert(!stored.includes(Buffer.from('SECRET-LOCATION-DATA')), 'EXIF is not kept');
    const id = j.saved[0].id;
    const back = await adminPhotos.GET(new NextRequest(`${A}?id=${id}`));
    equal(back.status, 200); equal(back.headers.get('content-type'), 'image/jpeg');
    // the seller, signed in as themselves
    await as('alpha-user@example.com', 11);
    const mine = await listVendorClaims(v.id);
    equal(mine[0].photos.length, 1); equal(mine[0].photos[0].side, 'staff');
    equal((await vendorPhotos.GET(new NextRequest(`${V}?id=${id}`))).status, 200);
  } finally { __setTestCookies(null); done(); }
});

test('TENANT ISOLATION: another seller can neither read nor add to a claim that is not theirs', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta');
    const ca = await deliveredClaim(a); const buf = await photo();
    await as('boss@example.test', 1);
    const before = keys();
    const id = (await (await adminPhotos.POST(upload(A, ca.id, buf))).json()).saved[0].id;
    await as('beta-user@example.com', 12);
    equal((await vendorPhotos.GET(new NextRequest(`${V}?id=${id}`))).status, 404);        // reading another seller's photo
    const j = await (await vendorPhotos.POST(upload(V, ca.id, buf))).json();               // writing to another seller's claim
    assert(!j.ok && j.saved.length === 0 && /not found/i.test(JSON.stringify(j.refused)), JSON.stringify(j));
    equal((await query('SELECT count(*)::int AS n FROM warranty_claim_photos WHERE claim_id = $1', [ca.id])).rows[0].n, 1);
    equal(added(before).length, 1);                                                          // the refused upload left no orphan file behind
    // and the real owner CAN add the repair photo
    await as('alpha-user@example.com', 11);
    const ok = await (await vendorPhotos.POST(upload(V, ca.id, buf))).json();
    assert(ok.ok, JSON.stringify(ok));
    equal((await listVendorClaims(a.id))[0].photos.map((p) => p.side).join(), 'staff,vendor');
  } finally { __setTestCookies(null); done(); }
});

test('what is not a photo, an empty upload and a missing claim are refused cleanly', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const c = await deliveredClaim(v); const before = keys();
    await as('boss@example.test', 1);
    const notImage = await (await adminPhotos.POST(upload(A, c.id, Buffer.from('this is not an image at all'), 'x.jpg'))).json();
    assert(!notImage.ok && notImage.refused.length === 1, JSON.stringify(notImage));
    const fd = new FormData(); fd.append('claimId', String(c.id));
    equal((await adminPhotos.POST(new NextRequest(A, { method: 'POST', body: fd }))).status, 400);
    const none = new FormData(); none.append('photos', new Blob([await photo()]), 'p.jpg');
    equal((await adminPhotos.POST(new NextRequest(A, { method: 'POST', body: none }))).status, 400);
    equal((await adminPhotos.GET(new NextRequest(`${A}?id=99999`))).status, 404);
    equal(added(before).length, 0);
  } finally { __setTestCookies(null); done(); }
});

suite('claims and deductions routes — real handlers, real sessions');
const json = (url, body) => new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const AC = 'http://localhost/api/admin/marketplace/claims';
const VC = 'http://localhost/api/vendor/claims';
const LG = 'http://localhost/api/admin/marketplace/ledger';

test('money is ADMIN only end to end: a rep sees no cost figures and cannot charge or deduct; the owner can, once', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const c = await deliveredClaim(v);
    await as('rep@example.test', 5);
    equal((await adminClaims.POST(json(AC, { action: 'charge', id: c.id, dollars: 50 }))).status, 403);
    equal((await ledgerRoute.POST(json(LG, { vendorId: v.id, key: 'k1', reason: 'chargeback', dollars: 5 }))).status, 403);
    equal((await ledgerRoute.GET(new NextRequest(`${LG}?vendorId=${v.id}`))).status, 403);
    const repView = await (await adminClaims.GET(new NextRequest(AC))).json();
    assert(!('costCents' in repView.claims[0]), 'no cost figure reaches a rep');
    const before = await vendorBalance(v.id, new Date(Date.now() + 90 * 86400000));
    await as('boss@example.test', 1);
    const ok = await (await adminClaims.POST(json(AC, { action: 'charge', id: c.id, dollars: 50, kind: 'guarantee_claim' }))).json();
    assert(ok.ok, JSON.stringify(ok));
    equal((await adminClaims.POST(json(AC, { action: 'charge', id: c.id, dollars: 50 }))).status, 400);   // never twice
    const after = await vendorBalance(v.id, new Date(Date.now() + 90 * 86400000));
    equal((before.availableCents + before.pendingCents + before.reserveHeldCents) - (after.availableCents + after.pendingCents + after.reserveHeldCents), 5000);
    // a deduction form submitted twice with the same key records once
    const d1 = await (await ledgerRoute.POST(json(LG, { vendorId: v.id, key: 'form-1', reason: 'chargeback', dollars: 12.5, memo: 'repair' }))).json();
    const d2 = await (await ledgerRoute.POST(json(LG, { vendorId: v.id, key: 'form-1', reason: 'chargeback', dollars: 12.5, memo: 'repair' }))).json();
    assert(d1.ok && !d1.duplicate && d2.duplicate, JSON.stringify([d1, d2]));
    equal((await (await ledgerRoute.POST(json(LG, { vendorId: v.id, key: 'form-2', reason: 'adjustment', dollars: 5 }))).json()).error, 'An adjustment needs a reason.');
    equal((await ledgerRoute.POST(json(LG, { vendorId: v.id, key: 'form-3', reason: 'nonsense', dollars: 5 }))).status, 400);
  } finally { __setTestCookies(null); done(); }
});

test('the seller\'s claims route: they answer their own, never another seller\'s, and never see the customer', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta'); const ca = await deliveredClaim(a);
    await as('beta-user@example.com', 12);
    const betaList = await (await vendorClaims.GET()).json(); equal(betaList.claims.length, 0);
    const bad = await vendorClaims.POST(json(VC, { action: 'respond', id: ca.id, note: 'I will fix this' }));
    equal(bad.status, 400); assert(/not found/i.test((await bad.json()).error), 'not found');
    await as('alpha-user@example.com', 11);
    const mine = await (await vendorClaims.GET()).json();
    equal(mine.claims.length, 1);
    assert(!/c@example.com|customer/i.test(JSON.stringify(mine.claims[0]).replace(/"description":"[^"]*"/, '')), 'no customer data');
    const ok = await vendorClaims.POST(json(VC, { action: 'respond', id: ca.id, note: 'Technician booked for Friday' }));
    equal(ok.status, 200);
    equal((await vendorClaims.POST(json(VC, { action: 'resolve', id: ca.id, resolution: 'repair', note: 'Replaced the compressor' }))).status, 200);
    equal((await (await vendorClaims.GET()).json()).claims[0].status, 'resolved');
  } finally { __setTestCookies(null); done(); }
});

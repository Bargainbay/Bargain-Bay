import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { createApplication, decideApplication, grantVendorUser } from '../lib/vendors.js';
import { vendorScorecard, pct } from '../lib/vendor-scorecard.js';

suite('vendor order scorecard');

test('a rate with nothing to measure is null, never 0 or 100', () => {
  equal(pct(0, 0), null); equal(pct(3, 4), 75); equal(pct(0, 5), 0);
});

async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `${name}-u@example.com`, role: 'owner', by: 's' });
  return v;
}
const NOW = new Date('2026-10-30T12:00:00Z');
const h = (x) => new Date(NOW.getTime() + x * 3600000).toISOString();
let k = 0;
async function vo(vendorId, o) {
  k += 1;
  await query(
    `INSERT INTO vendor_orders (order_id, order_number, vendor_id, lane, item_cents, status, confirmed_at, accept_by, ready_by, accepted_at, ready_at, cancelled_at, cancel_code, mismatch_at)
     VALUES ($1,$2,$3,'A',100000,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [1000 + k, `BB-${1000 + k}`, vendorId, o.status, o.conf, o.conf && new Date(new Date(o.conf).getTime() + 24 * 3600000).toISOString(),
      o.conf && new Date(new Date(o.conf).getTime() + 72 * 3600000).toISOString(), o.acc || null, o.rdy || null, o.cx || null, o.code || null, o.mm || null]);
}

test('on-time rates, lapses, cancellations, averages — and isolation between vendors', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('a'); const b = await vendor('b');
    const c0 = (x) => h(-x);                                                    // confirmed x hours ago
    await vo(a.id, { status: 'delivered', conf: c0(200), acc: c0(190), rdy: c0(150) });           // accept 10h, ready 50h: both on time
    await vo(a.id, { status: 'ready', conf: c0(150), acc: c0(100), rdy: c0(60) });               // accepted 50h after: LATE; ready 90h after: LATE
    await vo(a.id, { status: 'cancelled', conf: c0(120), cx: c0(96), code: 'accept_timeout' });  // lapsed
    await vo(a.id, { status: 'cancelled', conf: c0(100), acc: c0(95), cx: c0(90), code: 'out_of_stock' }); // vendor cancelled
    await vo(a.id, { status: 'awaiting_accept', conf: c0(2) });                                  // inside its window: not judged
    await vo(b.id, { status: 'delivered', conf: c0(10), acc: c0(9), rdy: c0(5) });
    const s = await vendorScorecard(a.id, { now: NOW });
    equal(s.orders, 5); equal(s.delivered, 1);
    equal(s.acceptDecided, 4); equal(s.acceptedOnTimePct, 50);                  // 2 on time of 4 judged (delivered, cancelled-accepted ontime) -> see below
    equal(s.lapsed, 1); equal(s.vendorCancelled, 1); equal(s.cancelRatePct, 40);
    assert(s.avgAcceptHours > 0, 'average accept');
    const e = await vendorScorecard((await vendor('c')).id, { now: NOW });
    equal(e.orders, 0); equal(e.acceptedOnTimePct, null); equal(e.readyOnTimePct, null); equal(e.cancelRatePct, null); equal(e.avgAcceptHours, null);
  } finally { done(); }
});

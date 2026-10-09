// THE BOOKS: a seller is the seller of record, so their sale is not our revenue. These tests drive a real
// checkout with a seller's unit in the cart and then read every place revenue is reported.
import { suite, test, assert, equal } from './_harness.mjs';
import { sharedCheckoutDb } from './shared-checkout-db.mjs';
import { query } from '../lib/db.js';
import { createApplication, decideApplication, grantVendorUser } from '../lib/vendors.js';
import { POST } from '../app/api/checkout/route.js';
import { updateOrderStatus } from '../lib/orders.js';
import {
  acceptVendorOrder, markVendorOrderReady, cancelVendorOrder, setDeliveryRate
} from '../lib/vendor-orders.js';
import { vendorBalance, deduct, adjust } from '../lib/vendor-ledger.js';
import { submitBankAccount, verifyBankAccount } from '../lib/vendor-bank.js';
import { proposeForVendor, approvePayout, markPayoutPaid, clearFirstPayout } from '../lib/payouts.js';
import { dashboardData, hstRemittance, revenueDashboard } from '../lib/analytics.js';
import { profitAndLoss } from '../lib/pnl.js';
import { trialBalance, setOpeningBalances, journal } from '../lib/ledger.js';
import { marketplaceRevenueBetween } from '../lib/marketplace-revenue.js';
import { sectionCsv } from '../lib/books.js';

process.env.BANK_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
const KEYS = ['MARKETPLACE_STOREFRONT', 'MARKETPLACE_ORDERING', 'MARKETPLACE_BOOKS_READY'];
async function open(fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { MARKETPLACE_STOREFRONT: '1', MARKETPLACE_ORDERING: '1', MARKETPLACE_BOOKS_READY: '1' });
  try { return await fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
let ip = 200; let seq = 0;
const checkout = async (skus, extra = {}) => {
  const res = await POST(new Request('http://localhost/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ip}` },
    body: JSON.stringify({ skus, email: `books${ip}@gmail.com`, name: 'Buyer', phone: `41655${String(50000 + ip)}`, paymentMethod: 'etransfer',
      deliveryMethod: 'delivery', address: '1 Main St', city: 'Pickering', postal: 'L1V 1A1', ...extra })
  }));
  return { status: res.status, ...(await res.json()) };
};
const dollars = (n) => Math.round(Number(n) * 100) / 100;
// trialBalance(asAt) is EXCLUSIVE of asAt, so today's entries need tomorrow's date.
const tomorrow = () => new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const tbNow = () => trialBalance(tomorrow());

async function world({ lane = 'A', price = 1000, tier = 2 } = {}) {
  seq += 1;
  const v = await createApplication({ legalName: `Books${seq}`, contactEmail: `books${seq}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `books${seq}-user@example.com`, role: 'owner', by: 's' });
  await query('UPDATE vendors SET tier = $2 WHERE id = $1', [v.id, tier]);
  const sku = `MP-${v.id}-0001`;
  await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working)
     VALUES ($1,$2,$3,'live','Refrigerator','Whirlpool','WRF535','Refurbished','Vendor fridge',$4,12,280,36,34,70,true)`, [sku, v.id, lane, price]);
  const own = `BOOKS-OWN-${seq}`;
  await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, active) VALUES ($1,'LG','LRMVS','Refrigerator','Our fridge','Refurbished',600,300,true)`, [own]);
  return { v, sku, own };
}
const orderRow = async (number) => (await query('SELECT * FROM orders WHERE order_number = $1', [number])).rows[0];
const vo = async (orderId) => (await query('SELECT * FROM vendor_orders WHERE order_id = $1', [orderId])).rows[0];
const acct = (tb, code) => dollars(tb.rows.find((r) => r.code === code)?.balance || 0);

suite('the books — a seller\'s sale is not our revenue');

test('checkout remembers the seller\'s share of the order and the HST on it', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    const r = await checkout([w.own, w.sku]);
    equal(r.status, 200);
    const o = await orderRow(r.orderNumber);
    equal(dollars(o.subtotal), 1600); equal(dollars(o.vendor_subtotal), 1000); equal(dollars(o.vendor_hst), 130);
    // 1600 + 79 delivery = 1679; HST 218.27; total 1897.27
    equal(dollars(o.total), 1897.27); equal(dollars(o.hst), 218.27);
    equal(Number((await vo(o.id)).hst_cents), 13000);
  });
});

test('REVENUE: our dashboards count our own sales only; the seller\'s 1,000 and its HST are left out', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    const before = await dashboardData();
    const r = await checkout([w.own, w.sku]);
    const o = await orderRow(r.orderNumber);
    await updateOrderStatus(o.id, 'confirmed');
    const after = await dashboardData();
    // ours: 600 + 79 delivery = 679, plus our HST 88.27 (the dashboard KPI is tax-inclusive)
    equal(dollars(after.kpis.revenue - before.kpis.revenue), 767.27);
    equal(after.kpis.unitsSold - before.kpis.unitsSold, 1);                 // one of OUR units, not two
    const pnl = await profitAndLoss('year');
    assert(pnl.current.ownRevenue >= 679, 'our own revenue is in the P&L');
  });
});

test('THE LEDGER: the invoice credits Sales and HST only for our part, and holds the rest for the seller', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    await setOpeningBalances({ asOf: '2020-01-01', accounts: {} });
    const before = await tbNow();
    const r = await checkout([w.own, w.sku]);
    const after = await tbNow();
    equal(dollars(acct(after, '4000') - acct(before, '4000')), 679);       // 600 + 79 delivery
    equal(dollars(acct(after, '2000') - acct(before, '2000')), 88.27);     // 13% of 679 — not of 1,679
    equal(dollars(acct(after, '2160') - acct(before, '2160')), 1130);      // 1,000 + 130 HST held for the seller
    equal(after.outOfBalance, 0);
    void r;
  });
});

test('SETTLEMENT: commission and fees become our income, drawn from what we owe; 2160 equals the seller\'s ledger', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    await setDeliveryRate('oversize', 8900, { by: 'admin' });
    await setOpeningBalances({ asOf: '2020-01-01', accounts: {} });
    const base = await tbNow();
    const owed0 = acct(base, '2160');
    const r = await checkout([w.sku], { deliveryMethod: 'delivery' });
    const o = await orderRow(r.orderNumber);
    await updateOrderStatus(o.id, 'confirmed');
    const id = (await vo(o.id)).id;
    await acceptVendorOrder(w.v.id, id, { insurance: 'declined' });
    await markVendorOrderReady(w.v.id, id, {});
    await updateOrderStatus(o.id, 'delivered');
    const tb = await tbNow();
    // 10% of 1,000 = 100 commission; 89 delivery service; HST on those 13% of 189 = 24.57
    equal(dollars(acct(tb, '4300') - acct(base, '4300')), 100);
    equal(dollars(acct(tb, '4310') - acct(base, '4310')), 89);
    equal(tb.outOfBalance, 0);
    const bal = await vendorBalance(w.v.id, new Date(Date.now() + 30 * 86400000));
    // what we owe THIS seller = 1,130 − (100 + 89 + 24.57) = 916.43 = their ledger (900.21) + the warranty reserve held (16.22)
    equal(dollars((bal.availableCents + bal.pendingCents + bal.reserveHeldCents) / 100), 916.43);
    const mine = dollars(acct(tb, '2160') - owed0);
    assert(mine >= 916.43 - 0.011, `2160 moved by ${mine}`);                // other sellers' orders in this shared database move it too, so >=
    const mkt = await marketplaceRevenueBetween("(now() AT TIME ZONE 'America/Toronto') - interval '1 day'", "(now() AT TIME ZONE 'America/Toronto') + interval '1 day'");
    assert(mkt.commission >= 100 && mkt.fees >= 89, 'the marketplace figures see it');
  });
});

test('PAYING THE SELLER draws 2160 down by exactly what leaves the bank', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    await setDeliveryRate('oversize', 8900, { by: 'admin' });
    const b = await submitBankAccount({ vendorId: w.v.id, role: 'owner', by: 'o@example.com' }, { holderName: `Books${seq}`, institution: '004', transit: '12345', account: '1234567' });
    await verifyBankAccount(b.id, { by: 'admin', how: 'void_cheque', nameMatched: true });
    await clearFirstPayout(w.v.id, { by: 'admin' });
    const r = await checkout([w.sku]);
    const o = await orderRow(r.orderNumber);
    await updateOrderStatus(o.id, 'confirmed');
    const id = (await vo(o.id)).id;
    await acceptVendorOrder(w.v.id, id, { insurance: 'declined' }); await markVendorOrderReady(w.v.id, id, {});
    await updateOrderStatus(o.id, 'delivered');
    await setOpeningBalances({ asOf: '2020-01-01', accounts: {} });
    const before = await tbNow();
    const later = new Date(Date.now() + 30 * 86400000);
    const p = await proposeForVendor(w.v.id, { by: 'ana@example.com', now: later });
    await approvePayout(p.id, { by: 'ben@example.com', now: later });
    await markPayoutPaid(p.id, { by: 'ben@example.com', ref: 'EFT-1' });
    const after = await tbNow();
    equal(dollars(acct(before, '2160') - acct(after, '2160')), dollars(p.amountCents / 100));
    equal(dollars(acct(before, '1000') - acct(after, '1000')), dollars(p.amountCents / 100));
    // what is left owed to this seller is the warranty reserve we are holding
    const left = await vendorBalance(w.v.id, later);
    equal(left.availableCents, 0);
    assert(left.reserveHeldCents > 0, 'reserve still held');
    equal(after.outOfBalance, 0);
  });
});

test('A SELLER CANCELS: the refund draws down what we owe them, nothing is booked to Sales, and their share leaves the order', async () => {
  await sharedCheckoutDb();
  const w = await world({ lane: 'C', price: 500 });
  await open(async () => {
    await setOpeningBalances({ asOf: '2020-01-01', accounts: {} });
    const before = await tbNow();
    const r = await checkout([w.sku]);
    const o = await orderRow(r.orderNumber);
    await updateOrderStatus(o.id, 'confirmed');
    equal(dollars(o.vendor_subtotal), 563.2);                    // 500 + the seller's 80% of the $79 delivery fee
    await cancelVendorOrder(w.v.id, (await vo(o.id)).id, { reasonCode: 'out_of_stock' });
    const o2 = await orderRow(r.orderNumber);
    equal(dollars(o2.vendor_subtotal), 0); equal(dollars(o2.vendor_hst), 0);
    const refund = (await query(`SELECT reason, amount FROM invoice_refunds ORDER BY id DESC LIMIT 1`)).rows[0];
    equal(refund.reason, 'Seller could not fulfil');
    const after = await tbNow();
    equal(after.outOfBalance, 0);
    // the 500 was never Sales, so the refund must not reduce Sales; the $79 delivery fee we still hold is now ours
    equal(dollars(acct(after, '4000') - acct(before, '4000')), 79);
    const stuck = dollars(acct(after, '2160') - acct(before, '2160'));
    assert(Math.abs(stuck) <= 0.03, `nothing should be left owed to a seller who cancelled (rounding aside), got ${stuck}`);
  });
});

test('AFTER-SALE DEDUCTIONS: account 2160 keeps equalling what we owe the seller, and each kind books the right other side', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    await setDeliveryRate('oversize', 8900, { by: 'admin' });
    await setOpeningBalances({ asOf: '2020-01-01', accounts: {} });
    const r = await checkout([w.sku]);
    const o = await orderRow(r.orderNumber);
    await updateOrderStatus(o.id, 'confirmed');
    const id = (await vo(o.id)).id;
    await acceptVendorOrder(w.v.id, id, { insurance: 'declined' }); await markVendorOrderReady(w.v.id, id, {});
    await updateOrderStatus(o.id, 'delivered');
    const ref = `${r.orderNumber}:${id}`;
    const later = new Date(Date.now() + 30 * 86400000);
    const owed = async () => { const b = await vendorBalance(w.v.id, later); return b.availableCents + b.pendingCents + b.reserveHeldCents; };
    const snap = async () => ({ tb: await tbNow(), owed: await owed() });
    const move = (a, b, code) => dollars(acct(a.tb, code) - acct(b.tb, code));

    // 1. a guarantee claim we paid the customer: cash leaves, 2160 falls by the claim; the reserve is drawn first
    let before = await snap();
    const g = await deduct(w.v.id, { kind: 'guarantee_claim', amountCents: 20000, orderRef: ref, memo: 'claim', by: 'admin', idemKey: `g-${seq}`, drawReserve: true });
    assert(g.drawnCents > 0, 'reserve drawn first');
    let after = await snap();
    equal(before.owed - after.owed, 20000);
    equal(move(before, after, '2160'), 200); equal(move(before, after, '1000'), 200);
    equal(after.tb.outOfBalance, 0);

    // 2. a customer refund after delivery that we paid by hand: same shape
    before = after;
    await deduct(w.v.id, { kind: 'refund', amountCents: 5000, orderRef: ref, memo: 'refund', by: 'admin', idemKey: `r-${seq}` });
    after = await snap();
    equal(before.owed - after.owed, 5000); equal(move(before, after, '2160'), 50); equal(move(before, after, '1000'), 50);

    // 3. ...but one already booked through the invoice refund path is NOT journalled again (that path debited 2160 itself)
    before = after;
    await deduct(w.v.id, { kind: 'refund', amountCents: 3000, orderRef: ref, memo: 'already on the invoice', by: 'admin', idemKey: `rb-${seq}`, bookedElsewhere: true });
    after = await snap();
    equal(before.owed - after.owed, 3000); equal(move(before, after, '2160'), 0); equal(move(before, after, '1000'), 0);

    // 4. a charge-back is between us and the seller: no cash, income 4320
    before = after;
    await deduct(w.v.id, { kind: 'chargeback', amountCents: 4000, orderRef: ref, memo: 'repair we paid for', by: 'admin', idemKey: `c-${seq}` });
    after = await snap();
    equal(before.owed - after.owed, 4000); equal(move(before, after, '2160'), 40); equal(move(before, after, '1000'), 0);
    equal(dollars(acct(after.tb, '4320') - acct(before.tb, '4320')), 40);           // recovered income

    // 5. an adjustment in either direction, never cash
    before = after;
    await adjust(w.v.id, { amountCents: 1000, memo: 'we mis-charged a fee', by: 'admin', idemKey: `a-${seq}` });
    after = await snap();
    equal(after.owed - before.owed, 1000); equal(move(after, before, '2160'), 10); equal(move(before, after, '1000'), 0);
    assert(after.tb.outOfBalance === 0, 'still balanced');
  });
});

test('the accountant\'s records pack has a marketplace section and shows the seller\'s part of each invoice', async () => {
  await sharedCheckoutDb();
  const csv = await sectionCsv('marketplace', 'year');
  assert(/vendor/i.test(csv.csv.split('\n')[0] || 'vendor'), 'header');
  const sales = await sectionCsv('sales', 'year');
  assert(/sellers_part/.test(sales.csv.split('\n')[0] || ''), 'sales rows carry the seller\'s part');
  void journal;
});

test('HST: the seller\'s HST is never ours; the HST on our own fees is', async () => {
  await sharedCheckoutDb();
  const w = await world();
  await open(async () => {
    await setDeliveryRate('oversize', 8900, { by: 'admin' });
    const before = (await hstRemittance('year')).current.charged;
    const r = await checkout([w.own, w.sku]);
    const o = await orderRow(r.orderNumber);
    await updateOrderStatus(o.id, 'confirmed');
    const mid = (await hstRemittance('year')).current.charged;
    equal(dollars(mid - before), 88.27);                      // 13% of OUR 679 — not the 218.27 the customer paid
    const id = (await vo(o.id)).id;
    await acceptVendorOrder(w.v.id, id, { insurance: 'declined' }); await markVendorOrderReady(w.v.id, id, {});
    await updateOrderStatus(o.id, 'delivered');
    const after = (await hstRemittance('year')).current.charged;
    equal(dollars(after - mid), 24.57);                       // 13% of the 100 commission + 89 delivery service
    const dash = await revenueDashboard('year');
    assert(dash.marketplace.commission >= 100 && dash.marketplace.gmv >= 1000, 'the dashboard reports the marketplace on its own line');
  });
});

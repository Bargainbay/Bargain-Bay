// The staff side of the marketplace: vendor lists, who sees money, tier overrides and the public application.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { createApplication, decideApplication, issueStrike } from '../lib/vendors.js';
import { listVendors, vendorDetail, setTier, submitPublicApplication } from '../lib/vendor-admin.js';

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}
const apply = (o = {}) => ({
  legalName: 'Alpha Appliances Ltd', tradeName: 'Alpha', contactName: 'Ana', contactEmail: 'ana@alpha.example',
  sourceOfGoods: 'Dealer or retailer overstock', acceptsTerms: true, ...o
});

suite('marketplace admin — vendors, money visibility and applying');

test('the vendor list shows standing and counts, and an applicant is listed as applied', async () => {
  const { done } = await withTestDb();
  try {
    const a = await createApplication({ legalName: 'Alpha', contactEmail: 'a@example.com' });
    await createApplication({ legalName: 'Bravo', contactEmail: 'b@example.com' });
    await decideApplication(a.id, { approve: true, by: 's', hstStatus: 'registered' });
    await issueStrike(a.id, { reason: 'missed_accept', by: 'system' });
    const all = await listVendors();
    equal(all.length, 2);
    const alpha = all.find((v) => v.name === 'Alpha');
    equal(alpha.strikes, 1); equal(alpha.standing, 'warning');
    equal((await listVendors({ status: 'applied' })).map((v) => v.name).join(), 'Bravo');
  } finally { done(); }
});

test('MONEY IS ADMIN ONLY: vendorDetail omits balance and bank unless asked', async () => {
  const { done } = await withTestDb();
  try {
    const v = await createApplication({ legalName: 'Alpha', contactEmail: 'a@example.com' });
    const staff = await vendorDetail(v.id);
    assert(!('balance' in staff) && !('bank' in staff) && !('commissionBps' in staff), 'staff view has no money');
    const admin = await vendorDetail(v.id, { money: true });
    equal(admin.balance.availableCents, 0); equal(admin.commissionBps, 1000); assert(admin.bank, 'bank summary for admin');
    equal(await vendorDetail(99999), null);
  } finally { done(); }
});

test('a tier override needs a reason and a name, is limited to 0–2, and is logged', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await createApplication({ legalName: 'Alpha', contactEmail: 'a@example.com' });
    await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
    await rejects(() => setTier(v.id, 3, { by: 'boss', reason: 'x' }), /0, 1 or 2/);
    await rejects(() => setTier(v.id, 1, { by: 'boss' }), /reason/);
    await rejects(() => setTier(v.id, 1, { reason: 'x' }), /Who/);
    await setTier(v.id, 1, { by: 'boss', reason: '30 clean days' });
    equal((await vendorDetail(v.id)).vendor.tier, 1);
    const { rows } = await client.query(`SELECT 1 FROM vendor_events WHERE vendor_id = $1 AND event = 'tier_set'`, [v.id]);
    equal(rows.length, 1);
  } finally { done(); }
});

test('the public application grants nothing, needs the essentials, and is throttled per email', async () => {
  const { done } = await withTestDb();
  try {
    await rejects(() => submitPublicApplication(apply({ contactName: '' })), /name/);
    await rejects(() => submitPublicApplication(apply({ sourceOfGoods: '' })), /stock/);
    await rejects(() => submitPublicApplication(apply({ acceptsTerms: false })), /guidelines/);
    const r = await submitPublicApplication(apply());
    const d = await vendorDetail(r.id);
    equal(d.vendor.status, 'applied'); equal(d.users.length, 0);       // no access of any kind
    equal(d.vendor.hstStatus, null);                                   // no HST number given: not assumed
    await submitPublicApplication(apply({ legalName: 'Alpha Two' }));
    await rejects(() => submitPublicApplication(apply({ legalName: 'Alpha Three' })), /already have/);
  } finally { done(); }
});

test('an HST number on the form is recorded as registered; applying twice with another email is not blocked', async () => {
  const { done } = await withTestDb();
  try {
    const r = await submitPublicApplication(apply({ hstNo: '123456789 RT0001' }));
    equal((await vendorDetail(r.id)).vendor.hstStatus, 'registered');
    await submitPublicApplication(apply({ contactEmail: 'other@beta.example', legalName: 'Beta' }));
  } finally { done(); }
});

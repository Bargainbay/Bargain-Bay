// The staff side of the marketplace: vendor lists, who sees money, tier overrides and the public application.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { createApplication, issueStrike } from '../lib/vendors.js';
import { decideApplication } from './approved-vendor.mjs';
import { listVendors, vendorDetail, setTier, submitPublicApplication, sellerStanding } from '../lib/vendor-admin.js';
import { requiredPolicies } from '../lib/marketplace-policies.js';
import { pendingPolicies } from '../lib/policy-acceptance.js';
import { query } from '../lib/db.js';

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}
const apply = (o = {}) => ({
  legalName: 'Alpha Appliances Ltd', tradeName: 'Alpha', contactName: 'Ana', contactEmail: 'ana@alpha.example',
  sourceOfGoods: 'Dealer or retailer overstock', acceptedPolicies: requiredPolicies().map((p) => ({ policy: p.slug, version: p.version })), businessNo: '100000009', hstNo: '100000009RT0001', ...o
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
    await rejects(() => submitPublicApplication(apply({ acceptedPolicies: [] })), /accept/);
    const r = await submitPublicApplication(apply());
    const d = await vendorDetail(r.id);
    equal(d.vendor.status, 'applied'); equal(d.users.length, 0);       // no access of any kind
    equal(d.vendor.hstStatus, 'registered');                         // the HST number is mandatory now
    await submitPublicApplication(apply({ legalName: 'Alpha Two' }));
    await rejects(() => submitPublicApplication(apply({ legalName: 'Alpha Three' })), /already have/);
  } finally { done(); }
});

test('sellerStanding tells an account whether it is applied, a seller, or neither; a rejection can reapply', async () => {
  const { done } = await withTestDb();
  try {
    const none = await sellerStanding('nobody@example.com');
    equal(none.access, null); equal(none.application, null);
    const r = await submitPublicApplication(apply({ contactEmail: 'Pat@Alpha.example' }));
    const applied = await sellerStanding('pat@alpha.example');
    equal(applied.application.id, r.id); equal(applied.application.status, 'applied'); equal(applied.access, null);
    await decideApplication(r.id, { approve: true, by: 'staff', hstStatus: 'registered' });
    await query(`INSERT INTO vendor_users (vendor_id, email, role) VALUES ($1,'pat@alpha.example','owner')`, [r.id]);
    const seller = await sellerStanding('PAT@alpha.example');
    equal(seller.access.id, r.id); equal(seller.application.status, 'approved');
  } finally { done(); }
});

test('an HST number on the form is recorded as registered; applying twice with another email is not blocked', async () => {
  const { done } = await withTestDb();
  try {
    const r = await submitPublicApplication(apply({ hstNo: '100000009 RT0001' }));
    equal((await vendorDetail(r.id)).vendor.hstStatus, 'registered');
    await submitPublicApplication(apply({ contactEmail: 'other@beta.example', legalName: 'Beta' }));
  } finally { done(); }
});


test('APPLYING IS ACCEPTING: the seller agreement is recorded at application and is not asked for again once approved', async () => {
  const { done } = await withTestDb();
  try {
    const need = requiredPolicies();
    assert(need.length > 0, 'there are required policies in force');
    // Missing one, or a stale version, is refused and creates nothing.
    await rejects(() => submitPublicApplication(apply({ acceptedPolicies: need.slice(1).map((p) => ({ policy: p.slug, version: p.version })) })), /accept/);
    await rejects(() => submitPublicApplication(apply({ acceptedPolicies: need.map((p) => ({ policy: p.slug, version: p.version + 1 })) })), /updated/);
    equal((await query('SELECT count(*)::int AS n FROM vendors')).rows[0].n, 0, 'a refused application creates no vendor');
    const r = await submitPublicApplication(apply(), { ip: '203.0.113.9' });
    const { rows } = await query('SELECT policy, version, accepted_by, ip FROM policy_acceptances WHERE vendor_id = $1', [r.id]);
    equal(rows.length, need.length);
    assert(rows.every((x) => x.accepted_by === 'ana@alpha.example' && x.ip === '203.0.113.9'), 'recorded under the applicant, with the ip');
    equal((await pendingPolicies(r.id)).length, 0, 'nothing left for them to accept after approval');
  } finally { done(); }
});

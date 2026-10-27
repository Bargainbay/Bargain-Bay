// Sellers must give a Business Number and HST account, the two must agree, they must be unique, and a
// person must record a CRA registry check before approval.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { createApplication, decideApplication, recordIdentityCheck, identityProblems } from '../lib/vendors.js';
import { submitPublicApplication } from '../lib/vendor-admin.js';
import { checkBusinessIds, normBn, normHst, namesAgree } from '../lib/business-ids.js';

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}
const apply = (o = {}) => ({
  legalName: 'Alpha Appliances Ltd', tradeName: 'Alpha', contactName: 'Ana', contactEmail: 'ana@alpha.example',
  sourceOfGoods: 'Dealer or retailer overstock', acceptsTerms: true, businessNo: '123456782', hstNo: '123456782 RT 0001', ...o
});

suite('seller identity — Business Number, HST account, CRA check');

test('number formats: check digit, RT suffix, and the HST must be the BN\'s own', () => {
  equal(normBn('123 456 782'), '123456782');
  equal(normBn('123456782RT0001'), '123456782');
  equal(normBn('123456789'), null);                       // bad check digit
  equal(normHst('123456782-rt-0001'), '123456782RT0001');
  equal(normHst('123456782'), null);
  assert(checkBusinessIds({ businessNo: '123456782', hstNo: '123456782RT0001' }).ok);
  assert(!checkBusinessIds({ businessNo: '', hstNo: '123456782RT0001' }).ok);
  assert(!checkBusinessIds({ businessNo: '123456782', hstNo: '' }).ok);
  assert(/belong/.test(checkBusinessIds({ businessNo: '123456782', hstNo: '100000009RT0001' }).problems[0]));
  assert(namesAgree('ALPHA APPLIANCES LIMITED', 'Alpha Appliances Ltd.'));
  assert(!namesAgree('Zeta Holdings Inc', 'Alpha Appliances Ltd', 'Alpha'));
});

test('the public application refuses a missing or malformed BN / HST number', async () => {
  const { done } = await withTestDb();
  try {
    await rejects(() => submitPublicApplication(apply({ businessNo: '' })), /Business Number is required/);
    await rejects(() => submitPublicApplication(apply({ hstNo: '' })), /HST number is required/);
    await rejects(() => submitPublicApplication(apply({ hstNo: '100000009RT0001' })), /does not belong/);
    await rejects(() => submitPublicApplication(apply({ businessNo: '123456789', hstNo: '123456789RT0001' })), /not valid/);
    const ok = await submitPublicApplication(apply());
    assert(ok.ok);
  } finally { done(); }
});

test('approval is blocked until the CRA check is recorded, then allowed', async () => {
  const { done } = await withTestDb();
  try {
    const { id } = await submitPublicApplication(apply());
    await rejects(() => decideApplication(id, { approve: true, by: 'staff@bb.ca' }), /CRA registry/);
    await rejects(() => recordIdentityCheck(id, { by: 'staff@bb.ca', registryName: 'Zeta Holdings Inc', active: true }), /does not match/);
    await rejects(() => recordIdentityCheck(id, { by: 'staff@bb.ca', registryName: 'Alpha Appliances Limited', active: false }), /active/);
    await recordIdentityCheck(id, { by: 'staff@bb.ca', registryName: 'ALPHA APPLIANCES LIMITED', active: true });
    equal((await identityProblems(id)).length, 0);
    equal((await decideApplication(id, { approve: true, by: 'staff@bb.ca' })).status, 'approved');
  } finally { done(); }
});

test('an application with no numbers can never be approved, and a reused number is flagged', async () => {
  const { done } = await withTestDb();
  try {
    const bare = await createApplication({ legalName: 'Bare Co', contactEmail: 'b@example.com' });
    await rejects(() => decideApplication(bare.id, { approve: true, by: 's' }), /Business Number is required/);
    await rejects(() => recordIdentityCheck(bare.id, { by: 's', registryName: 'Bare Co', active: true }), /Business Number is required/);
    const a = await submitPublicApplication(apply());
    const b = await submitPublicApplication(apply({ legalName: 'Alpha Two Ltd', tradeName: '', contactEmail: 'two@alpha.example' }));
    // both carry the same numbers, so neither can be checked until staff reject one
    await rejects(() => recordIdentityCheck(a.id, { by: 's', registryName: 'Alpha Appliances Ltd', active: true }), /already on another/);
    await rejects(() => recordIdentityCheck(b.id, { by: 's', registryName: 'Alpha Two Ltd', active: true }), /already on another/);
    await decideApplication(b.id, { approve: false, by: 's', reason: 'duplicate numbers' });
    await recordIdentityCheck(a.id, { by: 's', registryName: 'Alpha Appliances Ltd', active: true });
    equal((await decideApplication(a.id, { approve: true, by: 's' })).status, 'approved');
  } finally { done(); }
});

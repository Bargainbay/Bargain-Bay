// Vendor units on the storefront: visible only behind a flag, only when live, never leaking into
// the readers that were not asked for them, and never repriced by our own layers.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { createApplication, decideApplication, issueStrike } from '../lib/vendors.js';
import {
  marketplaceUnits, publicVendor, vendorsWithStock, publicPhotoPath, toUnit,
  marketplaceConditionCopy, storefrontOn, orderingOn, isMarketplaceSku
} from '../lib/marketplace-storefront.js';
import { loadUnits, getAll, getById, getMany } from '../lib/inventory.js';
import { groupByModel } from '../lib/group-units.js';
import { decorate } from '../lib/pricing.js';
import { imageFor } from '../lib/images.js';

function flags(vars, fn) {
  const keys = ['MARKETPLACE_STOREFRONT', 'MARKETPLACE_ORDERING'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const restore = () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  return Promise.resolve().then(fn).finally(restore);
}

async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  return v;
}
let n = 0;
async function listing(vendorId, over = {}) {
  n += 1;
  const sku = over.sku || `MP-${vendorId}-${String(n).padStart(4, '0')}`;
  const { rows } = await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, condition, title, description, price, compare_at, warranty_months, refurb_notes, tested_working)
     VALUES ($1,$2,$3,$4,'Refrigerator',$5,$6,$7,$8,'Cleaned and tested.',$9,$10,12,$11,true) RETURNING id`,
    [sku, vendorId, over.lane || 'A', over.status || 'live', over.make || 'Whirlpool', over.model || 'WRF535SWHZ',
     over.condition || 'Refurbished', over.title || 'Whirlpool WRF535SWHZ — French door fridge', over.price ?? 899, over.compareAt ?? 1799,
     over.refurbNotes ?? 'new door gasket']);
  return { id: rows[0].id, sku };
}
const photo = (listingId, role = 'front', kind = 'public') =>
  query(`INSERT INTO listing_photos (listing_id, kind, role, blob_path, position) VALUES ($1,$2,$3,$4,0) RETURNING id`,
    [listingId, kind, role, `marketplace/${listingId}/${role}.jpg`]).then((r) => r.rows[0].id);

suite('marketplace storefront — flags, opt-in and honest copy');

test('SKU recognition and the two flags default OFF', async () => {
  assert(isMarketplaceSku('MP-12-0001') && !isMarketplaceSku('SS-117082') && !isMarketplaceSku('MP-12') && !isMarketplaceSku(''), 'sku shape');
  await flags({}, () => { assert(!storefrontOn() && !orderingOn(), 'both off'); });
  await flags({ MARKETPLACE_STOREFRONT: '1' }, () => { assert(storefrontOn() && !orderingOn(), 'storefront only'); });
  await flags({ MARKETPLACE_STOREFRONT: 'true' }, () => { assert(!storefrontOn(), 'only the exact value "1" counts'); });
});

test('copy never claims our technicians tested a vendor\'s unit', () => {
  for (const c of ['New in Box', 'New Open Box', 'New Scratch & Dent', 'Refurbished']) {
    const t = marketplaceConditionCopy(c, 'Alpha', 'new gasket');
    assert(!/our technicians|bench-tested by our|one-year warranty from us/i.test(t), t);
    assert(/Alpha/.test(t), 'names the seller');
  }
  assert(/refurbished by Alpha: new gasket/.test(marketplaceConditionCopy('Refurbished', 'Alpha', 'new gasket')), 'says what was done');
  assert(/not as new/.test(marketplaceConditionCopy('Refurbished', 'Alpha')), 'never presented as new');
});

test('with the storefront flag OFF nothing is shown, whatever is live', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); await listing(v.id);
    await flags({}, async () => {
      equal((await marketplaceUnits()).length, 0);
      equal(await publicVendor('alpha'), null);
      equal((await vendorsWithStock()).length, 0);
    });
  } finally { done(); }
});

test('only LIVE units from an APPROVED vendor are shown, with public photos only', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    const live = await listing(a.id);
    await photo(live.id, 'front'); await photo(live.id, 'plate', 'evidence');
    await listing(a.id, { status: 'draft', model: 'DRAFT1' });
    await listing(a.id, { status: 'in_review', model: 'REVIEW1' });
    await listing(a.id, { status: 'sold', model: 'SOLD1' });
    await listing(b.id, { model: 'BRAVO1' });
    await flags({ MARKETPLACE_STOREFRONT: '1' }, async () => {
      const all = await marketplaceUnits();
      equal(all.map((u) => u.model).sort().join(), 'BRAVO1,WRF535SWHZ');
      const u = all.find((x) => x.model === 'WRF535SWHZ');
      equal(u.vendor.name, 'Alpha'); equal(u.vendor.slug, 'alpha'); equal(u.marketplace, true);
      equal(u.vendorPhotos.length, 1);                              // the rating plate is not in it
      assert(!JSON.stringify(u).includes('plate'), 'evidence never reaches the unit');
      equal(u.cost, 0); equal(u.orderable, false);
      equal((await marketplaceUnits({ slug: 'bravo' })).length, 1);
      equal((await marketplaceUnits({ ids: [live.sku] })).length, 1);
      equal((await vendorsWithStock()).map((v) => v.slug).sort().join(), 'alpha,bravo');
    });
    for (const reason of ['missed_accept', 'missed_ready', 'cancelled_order']) await issueStrike(b.id, { reason, by: 'system' });
    await flags({ MARKETPLACE_STOREFRONT: '1' }, async () => {
      equal((await marketplaceUnits({ slug: 'bravo' })).length, 0);   // restricted: off the shelf
      equal(await publicVendor('bravo'), null);
    });
  } finally { done(); }
});

test('the public photo route serves a public photo of a live listing and nothing else', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const live = await listing(v.id); const draft = await listing(v.id, { status: 'draft' });
    const pub = await photo(live.id); const plate = await photo(live.id, 'plate', 'evidence'); const dr = await photo(draft.id);
    assert(await publicPhotoPath(pub), 'public photo of a live unit');
    equal(await publicPhotoPath(plate), null);                      // evidence is never public
    equal(await publicPhotoPath(dr), null);                         // a draft is never public
    equal(await publicPhotoPath(999999), null);
  } finally { done(); }
});

test('OPT-IN: the default readers never include a vendor unit, even with the flag on', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id);
    await flags({ MARKETPLACE_STOREFRONT: '1', MARKETPLACE_ORDERING: '1' }, async () => {
      assert(!(await loadUnits()).some((u) => u.marketplace), 'loadUnits');
      assert(!(await getAll()).some((u) => u.marketplace), 'getAll() — feeds, sitemap, Sarah, the pickers');
      assert(!(await getAll({ strict: true, marketplace: true })).some((u) => u.marketplace), 'strict is never mixed');
      equal((await getMany([l.sku])).length, 0);                    // checkout cannot buy it yet
      equal(await getById(l.sku), null);                            // and the product page needs the opt-in
      const on = await getAll({ marketplace: true });
      assert(on.some((u) => u.sku === l.sku || u.id === l.sku), 'opt-in includes it');
      const one = await getById(l.sku, { marketplace: true });
      equal(one.vendor.name, 'Alpha'); equal(one.orderable, true);
    });
    await flags({}, async () => {
      assert(!(await getAll({ marketplace: true })).some((u) => u.marketplace), 'flag off: opt-in still shows nothing');
    });
  } finally { done(); }
});

test('grouping: a vendor\'s units group within that vendor, never across vendors or with ours', () => {
  const mk = (id, vendor) => ({ id, make: 'Whirlpool', model: 'WRF535SWHZ', price: 500, ...(vendor ? { vendor: { id: vendor } } : {}) });
  const g = groupByModel([mk('a1', 1), mk('a2', 1), mk('b1', 2), mk('own1')]);
  equal(g.length, 3);
  equal(g.find((x) => x.rep.id === 'a1').count, 2);
});

test('pricing: a vendor unit keeps its own price — no clearance, member tier or promo — and cost never leaks', async () => {
  const { done } = await withTestDb();
  try {
    const u = toUnit({ sku: 'MP-1-0001', vendor_id: 1, lane: 'A', category: 'Refrigerator', make: 'W', model: 'M', condition: 'Refurbished',
      title: 'T', description: 'd', refurb_notes: null, price: '899.00', compare_at: '1799.00', warranty_months: 12, slug: 'alpha', trade_name: 'Alpha', legal_name: 'Alpha Ltd' });
    const [d] = await decorate([{ ...u, cost: 5 }], { userId: 1 });
    equal(d.price, 899); equal(d.clientPrice, 899); equal(d.onClearance, false); equal(d.isMemberPrice, false);
    assert(!('cost' in d), 'cost stripped'); equal(d.vendor.name, 'Alpha'); equal(d.warrantyMonths, 12);
  } finally { done(); }
});

test('images: our stock photo leads when we have one for the model; otherwise the vendor\'s front photo', () => {
  const base = { marketplace: true, category: 'Refrigerator', vendorCover: '/api/mp-photo/7' };
  equal(imageFor({ ...base, model: 'NO-SUCH-MODEL-XYZ' }), '/api/mp-photo/7');
  assert(imageFor({ marketplace: true, category: 'Refrigerator', model: 'NO-SUCH-MODEL-XYZ' }).endsWith('.svg'), 'placeholder when neither exists');
});

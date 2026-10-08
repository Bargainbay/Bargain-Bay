// Marketplace listings: the rules (pure), the photo checks (real images), and the
// lifecycle against a real database — including that one vendor cannot reach another's.
import sharp from 'sharp';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  textProblems, titleProblems, normalizeFields, validateForSubmit, photoProblems, tierProblem,
  hammingDistance, isSamePicture, MARKET_CATEGORIES, LISTING_CONDITIONS
} from '../lib/listing-rules.js';
import { processListingImage, sniffImage } from '../lib/image-checks.js';
import {
  createApplication, decideApplication, issueStrike
} from '../lib/vendors.js';
import {
  createDraft, updateListing, attachPhoto, removePhoto, checkListing, submitListing, pauseListing,
  resumeListing, reopenForEdit, withdrawListing, listVendorListings, getVendorListing, reviewQueue,
  getListingForReview, reviewListing, checkInListing
} from '../lib/marketplace-listings.js';

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

// ---------------------------------------------------------------------------
suite('listing rules — what may be said and what must be there');

test('contact details and off-platform steering are caught in any text', () => {
  equal(textProblems('call 416-555-0199 any time').length, 1);
  equal(textProblems('email me at dave@example.com').length, 1);
  equal(textProblems('see www.mystore.ca for more').length, 1);
  assert(textProblems('Great fridge, WhatsApp me').length >= 1, 'whatsapp');
  assert(textProblems('text me for a discount').length >= 1, 'text me');
  equal(textProblems('Whirlpool WRF535SWHZ, 36 inch, stainless. Ice maker works.').length, 0);
});

test('titles: no capitals, emoji, promo words or prices', () => {
  assert(titleProblems('WHIRLPOOL FRENCH DOOR FRIDGE STAINLESS').length >= 1, 'caps');
  assert(titleProblems('Whirlpool fridge 🔥 stainless steel').length >= 1, 'emoji');
  assert(titleProblems('Best cheap fridge Whirlpool WRF535').length >= 1, 'promo');
  assert(titleProblems('Whirlpool WRF535SWHZ fridge $500').length >= 1, 'price');
  equal(titleProblems('Whirlpool WRF535SWHZ — French door fridge, 36", stainless').length, 0);
});

test('only the fields a vendor may set survive, and they are typed', () => {
  const f = normalizeFields({ make: '  Whirlpool ', price: '499.5', status: 'live', vendor_id: 9, id: 3, testedWorking: 'true', lane: 'b', evil: 1 });
  equal(f.make, 'Whirlpool'); equal(f.price, 499.5); equal(f.testedWorking, true); equal(f.lane, 'B');
  assert(!('status' in f) && !('vendor_id' in f) && !('id' in f) && !('evil' in f), 'smuggled fields dropped');
});

const good = (over = {}) => ({
  category: MARKET_CATEGORIES[0], make: 'Whirlpool', model: 'WRF535SWHZ', serial: 'SN-12345',
  condition: 'Refurbished', title: 'Whirlpool WRF535SWHZ — French door fridge, 36", stainless',
  description: 'Cleaned, new door gasket fitted, cools to temperature. Small scratch on the left side panel.',
  price: 899, compareAt: 1799, compareAtSource: 'https://example.com/whirlpool-wrf535',
  widthIn: 36, depthIn: 34, heightIn: 70, weightLb: 280, testedWorking: true,
  testNotes: 'Ran 24 hours, freezer -18C, fridge 3C', refurbNotes: 'Deep cleaned, replaced door gasket',
  warrantyMonths: 12, lane: 'A', ...over
});
const photos = (roles = ['front', 'back', 'interior', 'controls', 'defect', 'accessories', 'plate']) =>
  roles.map((role) => ({ role, kind: role === 'plate' ? 'evidence' : 'public' }));

test('a complete refurbished listing with a full photo set has no problems', () => {
  equal(validateForSubmit(good(), photos()).length, 0);
});

test('"Used" is refused and the vendor is told to say Refurbished', () => {
  const p = validateForSubmit(good({ condition: 'Used' }), photos());
  assert(p.some((x) => /Refurbished/.test(x.text)), 'tells them to use Refurbished');
  assert(!LISTING_CONDITIONS.includes('Used'), 'Used is not a listing condition');
});

test('every unit needs the full year of warranty', () => {
  assert(validateForSubmit(good({ warrantyMonths: 6 }), photos()).some((x) => x.field === 'warrantyMonths'), '6 months refused');
  assert(validateForSubmit(good({ warrantyMonths: null }), photos()).some((x) => x.field === 'warrantyMonths'), 'blank refused');
});

test('Refurbished must say what was done; a used unit cannot be called brand new', () => {
  assert(validateForSubmit(good({ refurbNotes: null }), photos()).some((x) => x.field === 'refurbNotes'), 'needs notes');
  assert(validateForSubmit(good({ description: 'Brand new fridge, never used, a lovely stainless unit.' }), photos())
    .some((x) => /brand new/i.test(x.text)), 'new claim on refurbished');
  equal(validateForSubmit(good({ condition: 'New in Box', refurbNotes: null, description: 'Brand new, still sealed in the factory box, stainless.' }),
    photos(['front', 'back', 'interior', 'controls', 'plate'])).length, 0);
});

test('a retail price needs a source, and must be higher than the price', () => {
  assert(validateForSubmit(good({ compareAtSource: null }), photos()).some((x) => x.field === 'compareAtSource'), 'source');
  assert(validateForSubmit(good({ compareAt: 500 }), photos()).some((x) => x.field === 'compareAt'), 'higher');
  equal(validateForSubmit(good({ compareAt: null, compareAtSource: null }), photos()).length, 0);
});

test('photos: enough of them, the right shots, and the private rating plate', () => {
  assert(photoProblems(photos(['front']), 'Refurbished').length >= 3, 'too few');
  assert(photoProblems(photos(['front', 'back', 'interior', 'controls', 'accessories', 'other']), 'Refurbished').some((x) => /rating plate/.test(x.text)), 'plate');
  assert(photoProblems(photos(['front', 'back', 'interior', 'controls', 'accessories', 'other', 'plate']), 'New Scratch & Dent').some((x) => /defect/.test(x.text)), 'dent needs a defect shot');
  equal(photoProblems(photos(['front', 'other', 'other', 'other', 'plate']), 'New in Box').length, 0);
});

test('tiers: probation is Lane A only and capped; self-shipping opens at Standard', () => {
  assert(tierProblem(0, 'B', 0) && tierProblem(0, 'C', 0), 'probation: not B or C');
  equal(tierProblem(0, 'A', 0), null);
  assert(tierProblem(0, 'A', 10), 'probation cap of 10');
  equal(tierProblem(1, 'C', 5), null);
});

test('picture matching tolerates a re-save but not a different photo', () => {
  equal(hammingDistance('0000000000000000', '0000000000000001'), 1);
  assert(isSamePicture('f0f0f0f0f0f0f0f0', 'f0f0f0f0f0f0f0f1'), 'near');
  assert(!isSamePicture('f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f'), 'far');
});

// ---------------------------------------------------------------------------
suite('photo pipeline — what an upload must survive');

const svg = (w, h, shift = 0) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ddd"/><rect x="${w * 0.2 + shift}" y="${h * 0.1}" width="${w * 0.4}" height="${h * 0.8}" fill="#333"/><circle cx="${w * 0.75}" cy="${h * 0.4}" r="${h * 0.2}" fill="#c33"/></svg>`);
const noise = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer();
async function photo(w = 1800, h = 1350, shift = 0) {
  const base = await sharp(svg(w, h, shift)).png().toBuffer();
  return sharp(base).composite([{ input: await noise(w, h), blend: 'soft-light' }]).jpeg().toBuffer();
}

test('a sharp, large photo is accepted and comes back as a fresh JPEG', async () => {
  const r = await processListingImage(await photo());
  assert(r.ok, JSON.stringify(r.problems));
  equal(sniffImage(r.buffer), 'jpeg');
  assert(r.phash && r.phash.length === 16, 'perceptual hash');
});

test('EXIF and GPS are stripped — the original bytes are never kept', async () => {
  const withExif = await sharp(await photo()).withExif({ IFD0: { Copyright: 'SECRET-GPS-MARKER' } }).jpeg().toBuffer();
  assert(withExif.includes(Buffer.from('SECRET-GPS-MARKER')), 'fixture carries the marker');
  const r = await processListingImage(withExif);
  assert(r.ok, 'accepted');
  assert(!r.buffer.includes(Buffer.from('SECRET-GPS-MARKER')), 'marker gone from what we store');
  equal((await sharp(r.buffer).metadata()).exif, undefined);
});

test('not-a-photo, empty, too small and out-of-focus are refused with a plain reason', async () => {
  assert(!(await processListingImage(Buffer.from('this is not an image, it is only text bytes'))).ok, 'text');
  assert(!(await processListingImage(Buffer.alloc(0))).ok, 'empty');
  const tiny = await processListingImage(await photo(500, 400));
  assert(!tiny.ok && /too small/.test(tiny.problems[0]), 'tiny');
  const flat = await processListingImage(await sharp({ create: { width: 1800, height: 1350, channels: 3, background: '#888' } }).jpeg().toBuffer());
  assert(!flat.ok && /focus/.test(flat.problems[0]), 'featureless');
  const smeared = await processListingImage(await sharp(await photo()).blur(10).jpeg().toBuffer());
  assert(!smeared.ok, 'smeared');
});

test('the same picture re-saved smaller hashes as the same; another photo does not', async () => {
  const a = await processListingImage(await photo());
  const smaller = await processListingImage(await sharp(await photo()).resize(1300, 975).jpeg().toBuffer());
  const other = await processListingImage(await photo(1800, 1350, 250));
  assert(isSamePicture(a.phash, smaller.phash), `re-saved distance ${hammingDistance(a.phash, smaller.phash)}`);
  assert(!isSamePicture(a.phash, other.phash), `different distance ${hammingDistance(a.phash, other.phash)}`);
});

test('low resolution is a warning, not a refusal', async () => {
  const r = await processListingImage(await photo(1300, 975));
  assert(r.ok && r.warnings.length === 1, JSON.stringify(r.warnings));
});

// ---------------------------------------------------------------------------
suite('listings — lifecycle and isolation against a real database');

async function vendor(name, { tier = 0 } = {}) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase().replace(/\W/g, '')}@example.com` });
  await decideApplication(v.id, { approve: true, by: 'staff', hstStatus: 'registered' });
  if (tier) await (await import('../lib/db.js')).query('UPDATE vendors SET tier = $2 WHERE id = $1', [v.id, tier]);
  return v;
}
let phashCounter = 1;
const fakePhash = () => (phashCounter++ * 0x1234567891).toString(16).padStart(16, '0').slice(-16);
async function fill(vendorId, listingId, roles = ['front', 'back', 'interior', 'controls', 'defect', 'accessories', 'plate']) {
  for (const role of roles) {
    await attachPhoto(vendorId, listingId, { role, blobPath: `marketplace/${listingId}/${role}-${Math.random()}.jpg`, width: 1800, height: 1350, bytes: 1, phash: fakePhash() });
  }
}
async function ready(vendorId, over = {}) {
  const { id, sku } = await createDraft(vendorId, good(over), { by: 'v@example.com' });
  await fill(vendorId, id);
  return { id, sku };
}

test('SKUs are numbered per vendor and the draft starts empty of status surprises', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    const a1 = await createDraft(a.id, {}); const a2 = await createDraft(a.id, {}); const b1 = await createDraft(b.id, {});
    equal(a1.sku, `MP-${a.id}-0001`); equal(a2.sku, `MP-${a.id}-0002`); equal(b1.sku, `MP-${b.id}-0001`);
    equal((await getVendorListing(a.id, a1.id)).status, 'draft');
  } finally { done(); }
});

test('TENANT ISOLATION: another vendor cannot read, edit, photograph, submit or withdraw a listing', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    const { id } = await ready(a.id);
    equal(await getVendorListing(b.id, id), null);
    equal((await listVendorListings(b.id)).length, 0);
    await rejects(() => updateListing(b.id, id, { price: 1 }), /not found/i);
    await rejects(() => attachPhoto(b.id, id, { role: 'front', blobPath: 'x' }), /not found/i);
    await rejects(() => submitListing(b.id, id), /not found/i);
    await rejects(() => withdrawListing(b.id, id), /cannot be withdrawn/);
    await rejects(() => checkListing(b.id, id), /not found/i);
    equal((await getVendorListing(a.id, id)).status, 'draft');
  } finally { done(); }
});

test('submitting an incomplete draft returns EVERYTHING that is wrong, and changes nothing', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await createDraft(a.id, { make: 'Whirlpool' });
    const r = await submitListing(a.id, id);
    assert(!r.ok && r.problems.length > 8, `${r.problems.length} problems`);
    equal((await getVendorListing(a.id, id)).status, 'draft');
  } finally { done(); }
});

test('a complete listing goes to review; Lane A then waits for check-in before it is for sale', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await ready(a.id);
    equal((await submitListing(a.id, id)).status, 'in_review');
    equal((await reviewQueue()).length, 1);
    await rejects(() => updateListing(a.id, id, { title: 'Something else entirely here' }), /cannot be edited/);
    equal((await reviewListing(id, { decision: 'approve', by: 'staff' })).status, 'awaiting_checkin');
    await rejects(() => checkInListing(id, { by: 'dock', accepted: false }), /why/);
    equal((await checkInListing(id, { by: 'dock', accepted: true })).status, 'live');
  } finally { done(); }
});

test('review can send it back with a note, reject with a listed reason, or re-grade the condition', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha', { tier: 1 });
    const one = await ready(a.id); await submitListing(a.id, one.id);
    await rejects(() => reviewListing(one.id, { decision: 'changes', by: 's' }), /what to change/);
    await reviewListing(one.id, { decision: 'changes', by: 's', note: 'Add a clearer photo of the dent' });
    const back = await getVendorListing(a.id, one.id);
    equal(back.status, 'changes_requested'); equal(back.reviewNote, 'Add a clearer photo of the dent');
    equal((await submitListing(a.id, one.id)).status, 'in_review');            // fixed and resubmitted
    const two = await ready(a.id, { serial: 'SN-OTHER' }); await submitListing(a.id, two.id);
    await rejects(() => reviewListing(two.id, { decision: 'reject', by: 's', reason: 'because' }), /list/);
    equal((await reviewListing(two.id, { decision: 'reject', by: 's', reason: 'condition_overstated' })).status, 'rejected');
    const three = await ready(a.id, { serial: 'SN-THREE', lane: 'B', pickupAddress: '1 Dock St', pickupPostal: 'L1W 3T9' });
    await submitListing(a.id, three.id);
    equal((await reviewListing(three.id, { decision: 'approve', by: 's', condition: 'New Open Box' })).status, 'live');
    await rejects(() => reviewListing(three.id, { decision: 'approve', by: 's' }), /not in review/);
  } finally { done(); }
});

test('re-grading to a retired label is refused', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await ready(a.id); await submitListing(a.id, id);
    await rejects(() => reviewListing(id, { decision: 'approve', by: 's', condition: 'Used' }), /valid condition/);
  } finally { done(); }
});

test('THE SERIAL GUARD: the same serial cannot be in play twice across vendors, and is freed when withdrawn', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    const first = await ready(a.id, { serial: 'SN-DUP-1' }); await submitListing(a.id, first.id);
    const second = await ready(b.id, { serial: ' sn-dup-1 ' });                  // case and spacing folded
    const r = await submitListing(b.id, second.id);
    assert(!r.ok && /already listed/.test(r.problems[0].text), 'blocked');
    assert(!/Alpha/.test(JSON.stringify(r)), 'does not say who has it');
    await withdrawListing(a.id, first.id);
    assert((await submitListing(b.id, second.id)).ok, 'freed once the first is withdrawn');
  } finally { done(); }
});

test('probation: Lane A only, ten at a time; Standard may self-ship', async () => {
  const { done } = await withTestDb();
  try {
    const p = await vendor('Probation');
    const c = await ready(p.id, { lane: 'C', serial: 'SN-C' });
    const r = await submitListing(p.id, c.id);
    assert(!r.ok && r.problems.some((x) => /Standard tier/.test(x.text)), 'lane C refused');
    for (let i = 0; i < 10; i++) { const l = await ready(p.id, { serial: `SN-P-${i}` }); assert((await submitListing(p.id, l.id)).ok, `unit ${i + 1}`); }
    const eleventh = await ready(p.id, { serial: 'SN-P-11' });
    assert((await submitListing(p.id, eleventh.id)).problems.some((x) => /limited to 10/.test(x.text)), 'cap');
    const s = await vendor('Standard', { tier: 1 });
    const sc = await ready(s.id, { lane: 'C', serial: 'SN-SC' });
    assert((await submitListing(s.id, sc.id)).ok, 'standard may self-ship');
  } finally { done(); }
});

test('a live listing can only have its price LOWERED; any other change means reopening it for review', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha', { tier: 1 });
    const { id } = await ready(a.id, { lane: 'B', pickupAddress: '1 Dock St', pickupPostal: 'L1W 3T9' });
    await submitListing(a.id, id); await reviewListing(id, { decision: 'approve', by: 's' });
    equal((await getVendorListing(a.id, id)).status, 'live');
    await rejects(() => updateListing(a.id, id, { price: 1500 }), /lowered/);
    await rejects(() => updateListing(a.id, id, { title: 'A completely different title for this fridge' }), /lowered/);
    await updateListing(a.id, id, { price: 799 });
    equal((await getVendorListing(a.id, id)).price, 799);
    await pauseListing(a.id, id);
    await reopenForEdit(a.id, id);
    await updateListing(a.id, id, { title: 'Whirlpool WRF535SWHZ — updated title, stainless' });
    equal((await submitListing(a.id, id)).status, 'in_review');                  // back through review
  } finally { done(); }
});

test('the third strike pauses what is on sale, and a restricted vendor cannot put it back', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha', { tier: 1 });
    const { id } = await ready(a.id, { lane: 'B', pickupAddress: '1 Dock St', pickupPostal: 'L1W 3T9' });
    await submitListing(a.id, id); await reviewListing(id, { decision: 'approve', by: 's' });
    for (const reason of ['missed_accept', 'missed_ready', 'cancelled_order']) await issueStrike(a.id, { reason, by: 'system' });
    equal((await getVendorListing(a.id, id)).status, 'paused');
    await rejects(() => resumeListing(a.id, id), /cannot put listings on sale/);
    await rejects(() => createDraft(a.id, {}), /cannot list/);
  } finally { done(); }
});

test('a restricted vendor\'s listings in review cannot be approved', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await ready(a.id); await submitListing(a.id, id);
    for (const reason of ['missed_accept', 'missed_ready', 'cancelled_order']) await issueStrike(a.id, { reason, by: 'system' });
    await rejects(() => reviewListing(id, { decision: 'approve', by: 's' }), /can no longer sell/);
  } finally { done(); }
});

test('the rating plate is private evidence, replaced rather than duplicated, and a photo is removable only in draft', async () => {
  const { client, done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await createDraft(a.id, good());
    await attachPhoto(a.id, id, { role: 'plate', blobPath: 'p/one.jpg', phash: fakePhash() });
    await attachPhoto(a.id, id, { role: 'plate', blobPath: 'p/two.jpg', phash: fakePhash() });
    const { rows } = await client.query(`SELECT kind, blob_path FROM listing_photos WHERE listing_id = $1`, [id]);
    equal(rows.length, 1); equal(rows[0].kind, 'evidence'); equal(rows[0].blob_path, 'p/two.jpg');
    const f = await attachPhoto(a.id, id, { role: 'front', blobPath: 'p/f.jpg', phash: fakePhash() });
    equal((await removePhoto(a.id, id, f.id)).blobPath, 'p/f.jpg');
    const full = await ready(a.id, { serial: 'SN-RM' }); await submitListing(a.id, full.id);
    await rejects(() => attachPhoto(a.id, full.id, { role: 'front', blobPath: 'x' }), /draft/);
  } finally { done(); }
});

test('the same picture on ANOTHER vendor\'s listing is flagged for staff; on your own it is not', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    const la = await createDraft(a.id, {}); const lb = await createDraft(b.id, {}); const la2 = await createDraft(a.id, {});
    const h = '8f3c5a21d4e6b790';
    equal((await attachPhoto(a.id, la.id, { role: 'front', blobPath: 'a/1.jpg', phash: h })).similarElsewhere, false);
    equal((await attachPhoto(a.id, la2.id, { role: 'front', blobPath: 'a/2.jpg', phash: h })).similarElsewhere, false);
    equal((await attachPhoto(b.id, lb.id, { role: 'front', blobPath: 'b/1.jpg', phash: '8f3c5a21d4e6b791' })).similarElsewhere, true);
  } finally { done(); }
});

test('the database refuses a warranty under a year, whatever the code does', async () => {
  const { client, done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await createDraft(a.id, {});
    let err;
    try { await client.query('UPDATE marketplace_listings SET warranty_months = 6 WHERE id = $1', [id]); } catch (e) { err = e; }
    assert(err, 'warranty check constraint');
  } finally { done(); }
});

test('staff see the private serial and the evidence photo; every transition is in the log', async () => {
  const { client, done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const { id } = await ready(a.id); await submitListing(a.id, id);
    await reviewListing(id, { decision: 'approve', by: 'staff@bb.ca' });
    const l = await getListingForReview(id);
    equal(l.serial, 'SN-12345');
    assert(l.photos.some((p) => p.kind === 'evidence' && p.role === 'plate'), 'plate visible to staff');
    const { rows } = await client.query('SELECT event FROM listing_events WHERE listing_id = $1 ORDER BY id', [id]);
    assert(rows.map((r) => r.event).join(',').endsWith('submitted,approved'), rows.map((r) => r.event).join(','));
  } finally { done(); }
});

void MARKET_CATEGORIES;

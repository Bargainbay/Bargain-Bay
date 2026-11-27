// A listed unit with no manufacturer photo shows placeholder art and is skipped
// by /feed, so it can't be advertised. Nothing used to say so: the sync reported
// success and the gap was found by looking at the shop (28 models, 2026-10-05).
import { suite, test, assert, equal } from './_harness.mjs';
import { modelsWithoutStockPhoto, imageFor } from '../lib/images.js';
import { syncSummary } from '../lib/sync-report.js';
import images from '../data/images.json' with { type: 'json' };

suite('stock photo gaps');

const known = Object.keys(images)[0];

test('groups units by model and ignores models that have a photo', () => {
  const r = modelsWithoutStockPhoto([
    { id: 'A-1', model: 'NOPE-1', make: 'LG' },
    { id: 'A-2', model: 'NOPE-1', make: 'LG' },
    { id: 'A-3', model: known },
    { id: 'A-4', model: 'NOPE-2' },
  ]);
  equal(r.length, 2);
  equal(r[0].model, 'NOPE-1');
  equal(r[0].skus.length, 2);
});

test('an explicit image override counts as having a photo', () => {
  equal(modelsWithoutStockPhoto([{ id: 'B-1', model: 'NOPE-3', image: 'https://x/y.jpg' }]).length, 0);
});

test('a unit with no model is still reported, per unit', () => {
  const r = modelsWithoutStockPhoto([{ id: 'C-1' }, { id: 'C-2', model: '' }]);
  equal(r.length, 2);
});

test('a word-only model is matched by make and model, never across brands', () => {
  const unit = { id: 'D-1', model: 'Laundry Centre', category: 'Laundry Centre' };
  equal(imageFor({ ...unit, make: 'Whirlpool' }), '/model-photos/YWET4027HW2.jpg');
  assert(imageFor({ ...unit, make: 'GE' }).endsWith('.svg'));
  equal(modelsWithoutStockPhoto([{ ...unit, make: 'Whirlpool' }]).length, 0);
});

test('the sync summary warns when models lack a photo, and is quiet otherwise', () => {
  const warn = syncSummary({ report: { noStockPhoto: [{ model: 'NOPE-1', skus: ['A-1', 'A-2'] }] } }).warnings;
  assert(warn.some((w) => w.includes('NOPE-1') && w.includes('2 units')));
  equal(syncSummary({ report: { noStockPhoto: [] } }).warnings.length, 0);
});

test('every images.json entry is an https URL or a file we ship in public/model-photos', async () => {
  const { existsSync } = await import('node:fs');
  for (const [k, v] of Object.entries(images)) {
    if (v.startsWith('/model-photos/')) assert(existsSync(new URL('../public' + v, import.meta.url)), `${k}: ${v} is missing from public/`);
    else assert(/^https:\/\//.test(v), `${k} is not an https URL`);
  }
});

// ---- the editable layer (model_photos) ----
import { withTestDb } from './db.mjs';
import { setModelPhoto, clearModelPhoto, modelPhotoRows, validPhotoUrl } from '../lib/model-photos.js';
import { modelImage } from '../lib/images.js';

suite('stock photos — managed from /admin/photos');

test('only full https links are accepted', () => {
  assert(validPhotoUrl('https://x.com/a.jpg'));
  equal(validPhotoUrl('http://x.com/a.jpg'), null);
  equal(validPhotoUrl('javascript:alert(1)'), null);
  equal(validPhotoUrl('/stock/range.svg'), null);
  equal(validPhotoUrl('https://x.com/a b.jpg'), null);
});

test('a row wins over images.json, and removing it falls back', async () => {
  const { client, done } = await withTestDb();
  try {
    await client.query(
      `INSERT INTO products (sku, make, model, category, title, price, active) VALUES ('T-1','LG','NEWMODEL-1','Range','t',100,true),('T-2','LG',$1,'Range','t',100,true)`, [known]);
    let rows = await modelPhotoRows();
    equal(rows[0].model, 'NEWMODEL-1');
    equal(rows[0].source, 'missing');
    await setModelPhoto('NEWMODEL-1', { url: 'https://cdn.example/new.jpg' }, { createdBy: 'a@b.c' });
    equal(modelImage('NEWMODEL-1'), 'https://cdn.example/new.jpg');
    // overriding a model that is in the file replaces it; clearing restores it
    await setModelPhoto(known, { url: 'https://cdn.example/over.jpg' });
    equal(modelImage(known), 'https://cdn.example/over.jpg');
    await clearModelPhoto(known);
    assert(modelImage(known) && modelImage(known) !== 'https://cdn.example/over.jpg');
    await clearModelPhoto('NEWMODEL-1');
    equal(modelImage('NEWMODEL-1'), null);
    rows = await modelPhotoRows();
    equal(rows.find((r) => r.model === 'NEWMODEL-1').source, 'missing');
  } finally { done(); }
});

// ---- the automatic finder ----
import { findStockPhoto, autoFixStockPhotos, hasModelNumber } from '../lib/stock-photo-finder.js';
import { handlePhotoGaps } from '../lib/catalog-sync.js';

suite('stock photo finder');

const CDN = 'https://cdn.shopify.com/s/files/1/x/dryer.jpg';
// A pretend internet: one retailer (`titles`) and a picture server that answers
// with `picture`. Everything else says it does not carry the model.
async function withFakeWeb({ titles = [], picture = 200, store = 200 }, fn) {
  const real = globalThis.fetch;
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const mails = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.resend.com')) { mails.push(JSON.parse(init.body)); return new Response('{"id":"1"}', { status: 200 }); }
    if (u.includes('/search/suggest.json')) {
      if (store !== 200) return new Response('', { status: store });
      const products = u.includes('leons.ca') ? titles.map((title) => ({ title, image: CDN })) : [];
      return new Response(JSON.stringify({ resources: { results: { products } } }), { status: 200 });
    }
    if (u === CDN) return picture === 200
      ? new Response(new Uint8Array(9000), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      : new Response('', { status: picture });
    return new Response('', { status: 410 });
  };
  try { return await fn(mails); }
  finally { globalThis.fetch = real; if (key !== undefined) process.env.ANTHROPIC_API_KEY = key; }
}

test('words that are not a model number are never searched', async () => {
  equal(hasModelNumber('Laundry Centre'), false);
  equal(hasModelNumber('Top Load Washer/Dryer Set'), false);
  assert(hasModelNumber('MVD420W'));
  await withFakeWeb({ titles: ['GE Laundry Centre'] }, async () => {
    equal(await findStockPhoto('Laundry Centre', 'Frigidaire'), null);
    const r = await autoFixStockPhotos([{ model: 'Laundry Centre', skus: ['A'] }]);
    equal(r.notFound.length, 1);
    equal(r.why['Laundry Centre'].transient, false);
  });
});

test("a refused Shopify picture check keeps the store's own link; a missing file does not", async () => {
  await withFakeWeb({ titles: ['Marathon Dryer MVD420W'], picture: 403 }, async () => {
    equal((await findStockPhoto('MVD420W', 'Marathon'))?.url, CDN);
  });
  await withFakeWeb({ titles: ['Marathon Dryer MVD420W'], picture: 404 }, async () => {
    equal(await findStockPhoto('MVD420W', 'Marathon'), null);
  });
});

test('a washer-and-dryer listing is not a picture of the dryer', async () => {
  await withFakeWeb({ titles: ['Electrolux Washer ELFW7437AW & Electric Dryer ELFE743CAW'] }, async () => {
    equal(await findStockPhoto('ELFE743CAW', 'Electrolux'), null);
  });
});

// Costco's headline never carries the model number; its own item line does
// (GTW500BMZWS sat photo-less because of this, 2026-11-25).
async function viaSearch(model, html, pageUrl = 'https://www.costco.ca/p/-/ge-washer/1') {
  const real = globalThis.fetch;
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'web_search_tool_result', content: [{ url: pageUrl }] }] }), { status: 200 });
    if (u === pageUrl) return new Response(html, { status: 200 });
    if (u.startsWith('https://gdx-assets.costco.com/')) return new Response(new Uint8Array(9000), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (u.includes('/search/suggest.json')) return new Response('{}', { status: 200 });
    return new Response('', { status: 410 });
  };
  try { return await findStockPhoto(model, 'GE'); }
  finally { globalThis.fetch = real; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
}
const OG = '<meta property="og:image" content="https://gdx-assets.costco.com/a/as/1__1.avif?width=350"/><h1>GE 5.0 cu ft. Washer</h1>';

test("a Costco page whose item line names the model is accepted, as a JPEG", async () => {
  const hit = await viaSearch('GTW500BMZWS', `${OG}<div>Item 3999999 | Model GTW500BMZWS</div>`);
  equal(hit?.url, 'https://gdx-assets.costco.com/a/as/1__1.jpg?width=1024&height=1024&fit=contain');
});

test('a page that only mentions the model, or sells it in a bundle, is refused', async () => {
  equal(await viaSearch('GTW500BMZWS', `${OG}<div>Item 1 | Model GTW550BMRWS</div><p>Related: Model GTW500BMZWS</p>`), null);
  equal(await viaSearch('GTW500BMZWS', `${OG}<div>Item 1 | Model GTW500BMZWS | GTD45EBMZWS</div>`), null);
  equal(await viaSearch('GTW500BMZWS', `${OG}<div>Item 1 | Model GTW500BMZWS</div>`, 'https://shop.example/p/1'), null);
});

test("a product page that declares the model in its own product data is accepted", async () => {
  const ld = '<script type="application/ld+json">{"@type":"Product","mpn":"GTW500BMZWS"}</script>';
  assert(await viaSearch('GTW500BMZWS', `${OG}${ld}`, 'https://shop.example/p/1'));
});

test('models past the per-run cap are not reported as failures', async () => {
  await withFakeWeb({}, async () => {
    const r = await autoFixStockPhotos(Array.from({ length: 10 }, (_, i) => ({ model: `ZZZ${i}000`, skus: ['A'] })));
    equal(r.notFound.length, 8);
    equal(r.notTried.length, 2);
  });
});

test('a refusal is retried hourly and only mailed, with the reason, after three goes', async () => {
  const { done } = await withTestDb();
  const env = { v: process.env.VERCEL_ENV, k: process.env.RESEND_API_KEY };
  const now = Date.now;
  process.env.VERCEL_ENV = 'production';
  process.env.RESEND_API_KEY = 'test-key';
  try {
    await withFakeWeb({ store: 429 }, async (mails) => {
      const gaps = [{ model: 'MVD420W', make: 'Marathon', category: 'Dryer', skus: ['A'] }];
      let t = now();
      Date.now = () => t;
      await handlePhotoGaps(gaps);
      equal(mails.length, 0);
      t += 61 * 60 * 1000; await handlePhotoGaps(gaps);
      equal(mails.length, 0);
      t += 61 * 60 * 1000; await handlePhotoGaps(gaps);
      assert(mails.length > 0, 'told after the third refusal');
      assert(mails[0].html.includes('refused (429)'), 'the email says why');
      const n = mails.length;
      t += 25 * 60 * 60 * 1000; await handlePhotoGaps(gaps);
      equal(mails.length, n);
    });
  } finally {
    Date.now = now;
    if (env.v === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env.v;
    if (env.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = env.k;
    done();
  }
});

// lib/vesta.js — Vesta Kitchen's range as storefront units.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { classify, toRow, toUnit, syncVesta, vestaUnits, isVestaSku } from '../lib/vesta.js';

suite('lib/vesta — mirrored catalogue');

const prod = (o = {}) => ({
  id: 1, handle: 'h', title: 'Clearance! 30" Under Cabinet Range Hood', product_type: 'Under Cabinet',
  body_html: '<p>Quiet &amp; strong</p><ul><li>300 CFM</li></ul>', tags: ['a'],
  variants: [{ price: '199.00', compare_at_price: '299.00', available: true }],
  images: Array.from({ length: 19 }, (_, i) => ({ src: `https://cdn/x${i}.jpg` })), ...o
});

test('classify maps types and titles to a category and subcategory', () => {
  equal(classify('Under Cabinet', 'x'), { category: 'Range Hood', subcategory: 'Under Cabinet' });
  equal(classify('Cooktops', '30 Induction Cooktop').subcategory, 'Induction');
  equal(classify('Accessories', 'Charcoal Filter').category, 'Range Hood Accessories');
  equal(classify('nonsense', 'Mystery'), null);
});

test('warranty add-ons and placeholder prices are not listed', () => {
  equal(toRow(prod({ product_type: 'warranty' })), null);
  equal(toRow(prod({ variants: [{ price: '9999.00', available: true }] })), null);
  equal(toRow(prod({ variants: [{ price: '1.00', available: true }] })), null);
});

test('EVERY image Vesta publishes is kept, not just the first twelve', () => {
  const r = toRow(prod());
  equal(r.images.length, 19);
  equal(r.title, '30" Under Cabinet Range Hood');
  equal(r.compare_at, 299);
  assert(r.description.includes('Quiet & strong'));
});

test('a unit is Vesta-priced, new, and orderable only while ordering is on and in stock', () => {
  delete process.env.VESTA_ORDERING;
  const u = toUnit({ ...toRow(prod()), compare_at: 299 });
  assert(isVestaSku(u.id));
  equal(u.condition, 'New in Box');
  equal(u.orderable, false);
  equal(u.vestaImages.length, 19);
  process.env.VESTA_ORDERING = '1';
  equal(toUnit(toRow(prod())).orderable, true);
  equal(toUnit(toRow(prod({ variants: [{ price: '199', available: false }] }))).orderable, false);
  delete process.env.VESTA_ORDERING;
});

test('sync stores all images, serves them, and retires what left the feed', async () => {
  const t = await withTestDb();
  try {
    const feed = (products) => async () => ({ ok: true, json: async () => ({ products }) });
    const a = prod({ id: 1 }), b = prod({ id: 2, title: 'Other Hood' });
    const r1 = await syncVesta({ fetcher: feed([a, b]) });
    equal(r1.listed, 2);
    const units = await vestaUnits();
    equal(units.length, 2);
    equal(units.find((u) => u.id === 'VS-1').vestaImages.length, 19);
    await syncVesta({ fetcher: feed([a]) });
    equal((await vestaUnits()).map((u) => u.id), ['VS-1']);
  } finally { t.done(); }
});

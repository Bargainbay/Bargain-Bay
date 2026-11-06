// Facebook Marketplace listing kit: the title fits Facebook's limit, the caption ends with the
// profile + contact lines, the photo list leads with the stock picture, and the zip is valid.
import { suite, test, equal, assert } from './_harness.mjs';
import { fbListing, fbTitle, FB_TITLE_MAX } from '../lib/fb-kit.js';
import { zipStore } from '../lib/zip-lite.js';

suite('facebook listing kit');

const unit = { id: 'X1', make: 'LG', model: 'LREN6321YE', category: 'Refrigerator',
  title: 'LG 30 Inch 21 cu. ft. Stainless Steel Refrigerator', condition: 'Scratch & Dent',
  price: 899, compareAt: 1499, warrantyMonths: 12, image: 'https://assets.ajmadison.com/x.jpg',
  photos: [{ url: '/api/photo/products/X1-0.jpg' }] };

test('caption ends by sending people to the profile and to message', () => {
  const c = fbListing(unit).caption.trim().split('\n');
  assert(/other listings/i.test(c[c.length - 2]), 'profile line second to last');
  assert(/message me/i.test(c[c.length - 1]), 'contact line last');
});

test('caption states price and never mentions cost', () => {
  const c = fbListing({ ...unit, cost: 123 }).caption;
  assert(c.includes('$899') && c.includes('$1,499'));
  assert(!c.includes('123'));
});

test('title is capped at the Facebook limit', () => {
  assert(fbTitle({ ...unit, title: 'A '.repeat(80) }).length <= FB_TITLE_MAX);
});

test('zip has the right signatures and entry count', () => {
  const z = zipStore([{ name: 'a.txt', data: Buffer.from('hi') }, { name: 'b.txt', data: Buffer.from('yo') }]);
  equal(z.readUInt32LE(0), 0x04034b50);
  equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  equal(z.readUInt16LE(z.length - 22 + 10), 2);
});

test('refurbished is 3 months, others keep theirs, and there is no pickup address', () => {
  const r = fbListing({ ...unit, condition: 'Refurbished' }).caption;
  assert(r.includes('3-month warranty'));
  assert(fbListing(unit).caption.includes('one-year warranty'));
  assert(!/Squires|pickup/i.test(r));
});

test('a description and features come before the condition', () => {
  const c = fbListing({ ...unit, model: 'EX305CCO' }).caption;
  assert(c.includes('Features:') && c.indexOf('Features:') < c.indexOf('Condition:'));
  const plain = fbListing(unit).caption;
  assert(plain.indexOf('30-inch') > -1 && plain.indexOf('30-inch') < plain.indexOf('Condition:'));
});

// lib/location-codes.js — what is printed on a label, and what comes back when
// somebody scans one.
//
// This is pinned because a label is the one thing in this system that CANNOT be
// corrected after the fact: it is stuck on an appliance, a shelf upright or a
// bin of igniters, and the only fix is walking round the building with a roll.
// The payload shape is also duplicated in RS Ops (its app/labels/*), which
// prints from the same rolls onto the same stock — so if these change, that
// copy has to change in the same breath.
import { suite, test, assert, equal } from './_harness.mjs';
import { parseScan, partScanUrl, spotScanUrl, unitScanUrl, normPartId } from '../lib/location-codes.js';

suite('lib/location-codes — label payloads and what a scan reads back');

const BASE = 'https://bargainbay.ca';

test('the three labels carry the documented URLs', () => {
  equal(unitScanUrl(BASE, 'SS-117082'), 'https://bargainbay.ca/w/u/SS-117082');
  equal(spotScanUrl(BASE, 'l3-2'), 'https://bargainbay.ca/w/l/L3-2');
  equal(partScanUrl(BASE, 42), 'https://bargainbay.ca/w/p/42');
});

test('a trailing slash on the base never doubles up', () => {
  equal(partScanUrl('https://bargainbay.ca/', 7), 'https://bargainbay.ca/w/p/7');
});

test('every label scans back to what it is', () => {
  for (const [url, kind, value] of [
    [unitScanUrl(BASE, 'SS-117082'), 'unit', 'SS-117082'],
    [spotScanUrl(BASE, 'L3-2'), 'location', 'L3-2'],
    [partScanUrl(BASE, 42), 'part', 42]
  ]) {
    const p = parseScan(url);
    equal(p.kind, kind, url);
    equal(p.value, value, url);
  }
});

test('the host is ignored — a sticker printed on the vercel.app address still scans', () => {
  equal(parseScan('https://bargain-bay-two.vercel.app/w/p/42').kind, 'part');
  equal(parseScan('https://bargain-bay-two.vercel.app/w/p/42').value, 42);
});

// A part label carries the ID, not the part number, and the id is a row. If a
// scanner ever hands back something that is not one, the honest answer is "I do
// not know what that is" — a part 0 or a NaN part would open somebody else's
// bin, or nothing, with no way to tell which happened.
test('a part label that is not a row falls through to text, never to a bogus part', () => {
  for (const bad of ['0', '-3', 'W10295370A', 'abc']) {
    const p = parseScan(`${BASE}/w/p/${bad}`);
    equal(p.kind, 'text', bad);
  }
  equal(normPartId('0'), null);
  equal(normPartId('12'), 12);
  equal(normPartId(' 12 '), 12);
});

// The whole reason a label carries a URL rather than a bare code: `V4` the lane
// and `V4-001` the SKU are one dash apart, and a scanner cannot tell them apart
// by shape.
test('a spot and a unit are told apart by the label, not by the text', () => {
  equal(parseScan(`${BASE}/w/l/V4`).kind, 'location');
  equal(parseScan(`${BASE}/w/u/V4-001`).kind, 'unit');
  // Typed in, or off a handheld wedge: still just text for the caller to resolve.
  equal(parseScan('V4').kind, 'text');
});

test('nothing at all is nothing, not a crash', () => {
  assert(parseScan('') === null);
  assert(parseScan(null) === null);
});

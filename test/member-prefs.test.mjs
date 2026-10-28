// lib/member-prefs.js — what the member dashboard remembers: the stock already seen, and the watchlist.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { recordVisit, saveWatch, getWatch, normalizeWatch, SEEN_REFRESH_MS } from '../lib/member-prefs.js';

suite('member prefs — watchlist terms');

test('terms are folded, trimmed, de-duplicated and capped', () => {
  equal(normalizeWatch([' LG ', 'lg', 'Lg', '  ranges  ', '', null, 'FRIGIDAIRE  36']), ['lg', 'ranges', 'frigidaire 36']);
  equal(normalizeWatch('nope'), []);
  equal(normalizeWatch(Array.from({ length: 50 }, (_, i) => 't' + i)).length, 30);
  equal(normalizeWatch(['x'.repeat(200)])[0].length, 40);
});

suite('member prefs — new since the last visit');

test('the first visit marks nothing new, and the next one flags only SKUs not seen before', async () => {
  const { done } = await withTestDb();
  try {
    const t0 = 1_000_000_000_000;
    const first = await recordVisit(7, ['A', 'B', 'C'], t0);
    equal(first.firstVisit, true);
    equal(first.newSkus, [], 'the whole shop is not "new" on day one');

    const later = await recordVisit(7, ['A', 'B', 'C', 'D', 'E'], t0 + SEEN_REFRESH_MS + 1);
    equal(later.firstVisit, false);
    equal(later.newSkus, ['D', 'E']);

    const after = await recordVisit(7, ['A', 'B', 'C', 'D', 'E', 'F'], t0 + 2 * SEEN_REFRESH_MS + 5);
    equal(after.newSkus, ['F'], 'D and E were seen on the previous visit');
  } finally { done(); }
});

test('reloading the page does not wipe the badges the member has not had time to look at', async () => {
  const { done } = await withTestDb();
  try {
    const t0 = 2_000_000_000_000;
    await recordVisit(8, ['A'], t0);
    const a = await recordVisit(8, ['A', 'B'], t0 + SEEN_REFRESH_MS + 1);
    equal(a.newSkus, ['B']);
    const reload = await recordVisit(8, ['A', 'B'], t0 + SEEN_REFRESH_MS + 60_000);
    equal(reload.newSkus, ['B'], 'a minute later it is still new');
  } finally { done(); }
});

test('members do not share what they have seen', async () => {
  const { done } = await withTestDb();
  try {
    const t0 = 3_000_000_000_000;
    await recordVisit(1, ['A'], t0);
    const other = await recordVisit(2, ['A'], t0 + 10);
    equal(other.firstVisit, true);
  } finally { done(); }
});

suite('member prefs — watchlist storage');

test('a saved watchlist comes back, and a visit does not erase it', async () => {
  const { done } = await withTestDb();
  try {
    equal(await getWatch(9), []);
    equal(await saveWatch(9, ['LG', 'ranges', 'lg']), ['lg', 'ranges']);
    equal(await getWatch(9), ['lg', 'ranges']);
    const t0 = 4_000_000_000_000;
    await recordVisit(9, ['A'], t0);
    await recordVisit(9, ['A', 'B'], t0 + SEEN_REFRESH_MS + 1);
    equal(await getWatch(9), ['lg', 'ranges'], 'recording a visit keeps the watchlist');
    await saveWatch(9, ['bosch']);
    const v = await recordVisit(9, ['A', 'B', 'C'], t0 + SEEN_REFRESH_MS + 100);
    equal(v.newSkus, ['B', 'C'], 'saving the watchlist leaves the session baseline alone: B is still new this session, C arrived since');
  } finally { done(); }
});

test('with no database it degrades to an empty dashboard, not an error', async () => {
  delete process.env.POSTGRES_URL;
  const v = await recordVisit(5, ['A']);
  assert(Array.isArray(v.newSkus));
  equal(v.newSkus, []);
  equal(v.watch, []);
});

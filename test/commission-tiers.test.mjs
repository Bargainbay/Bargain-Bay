// lib/commission-tiers.js — the daily commission, to the cent.
//
// Owner's tiers (2026-11-10): $5,000 or less pays nothing; over $5,000 pays 1% of the WHOLE day; over $10,000 2%;
// over $20,000 3%. "Over" is the default reading of each line (as the agreement has always said); `inclusive`
// makes a line count at exactly the figure ("$20,000 or more"). Both are pinned.
import { suite, test, equal } from './_harness.mjs';
import { tieredCommission, nextTier, normalizeTiers, DEFAULT_TIERS } from '../lib/commission-tiers.js';

const pay = (n, tiers) => tieredCommission(n, tiers).commission;
const inclusive20 = [{ over: 5000, pct: 1 }, { over: 10000, pct: 2 }, { over: 20000, pct: 3, inclusive: true }];

suite('commission tiers — the written rule');

test('the default is the owner\'s three tiers', () => { equal(DEFAULT_TIERS, [{ over: 5000, pct: 1 }, { over: 10000, pct: 2 }, { over: 20000, pct: 3 }]); });
test('under and at $5,000: nothing', () => { equal(pay(0), 0); equal(pay(4000), 0); equal(pay(5000), 0); });
test('over $5,000: 1% of the whole day (a cliff, not a margin)', () => { equal(pay(5000.01), 50.0); equal(pay(8000), 80); equal(pay(10000), 100); });
test('over $10,000: 2% of the whole day', () => { equal(pay(10000.01), 200.0); equal(pay(15000), 300); equal(pay(20000), 400); });
test('over $20,000: 3% of the whole day, with no tier above it', () => { equal(pay(20000.01), 600.0); equal(pay(25000), 750); equal(pay(30000), 900); equal(pay(40000), 1200); });
test('a negative or empty day pays nothing, never a debt', () => { equal(pay(-500), 0); equal(pay(null), 0); });
test('a payment of exactly one cent over the line crosses it', () => { equal(tieredCommission(5000.01).pct, 1); equal(tieredCommission(5000).pct, 0); });

suite('commission tiers — an inclusive line');

test('with the $20,000 line inclusive, a $20,000 day earns 3%', () => {
  equal(pay(20000, inclusive20), 600); equal(pay(15000, inclusive20), 300); equal(pay(9000, inclusive20), 90); equal(pay(4000, inclusive20), 0);
});

suite('commission tiers — settings and the next tier');

test('tiers from settings are cleaned and sorted; junk falls back to the default', () => {
  equal(normalizeTiers([{ over: 20000, pct: 3 }, { over: 'x', pct: 1 }, { over: 10000, pct: 1 }]).map((t) => t.over), [10000, 20000]);
  equal(normalizeTiers(null).map((t) => t.pct), DEFAULT_TIERS.map((t) => t.pct));
  equal(normalizeTiers([{ over: 1, pct: 500 }]).length, 3, 'an impossible rate is thrown out');
});

test('how far to the next tier, and what crossing it pays', () => {
  const n = nextTier(3000);
  equal(n.pct, 1); equal(n.moreNeeded, 2000.01); equal(n.wouldPay, 50);
  const m = nextTier(19000); equal(m.pct, 3); equal(m.moreNeeded, 1000.01); equal(m.wouldPay, 600);
  equal(nextTier(50000), null, 'nothing above the top tier');
  equal(nextTier(19999, inclusive20).moreNeeded, 1, 'an inclusive line needs exactly the line');
});

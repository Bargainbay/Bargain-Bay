// lib/commission-tiers.js — the daily commission, to the cent.
//
// The agreement's rule: $10,000 or less pays nothing; over $10,000 pays 1% of the WHOLE day; over $20,000
// 1.5%; over $30,000 2%. Its worked example says a $30,000 day earns $600, which only holds if the
// $30,000 line is INCLUSIVE — the rule's own words ("over") give $450 at exactly $30,000. Both readings
// are pinned: the default follows the rule, `inclusive` reproduces the example.
import { suite, test, equal } from './_harness.mjs';
import { tieredCommission, nextTier, normalizeTiers, DEFAULT_TIERS } from '../lib/commission-tiers.js';

const pay = (n, tiers) => tieredCommission(n, tiers).commission;
const inclusive30 = [{ over: 10000, pct: 1 }, { over: 20000, pct: 1.5 }, { over: 30000, pct: 2, inclusive: true }];

suite('commission tiers — the written rule');

test('under and at $10,000: nothing', () => { equal(pay(0), 0); equal(pay(9000), 0); equal(pay(10000), 0); });
test('over $10,000: 1% of the whole day (a cliff, not a margin)', () => { equal(pay(10000.01), 100.0); equal(pay(15000), 150); equal(pay(20000), 200); });
test('over $20,000: 1.5% of the whole day', () => { equal(pay(20000.01), 300.0); equal(pay(25000), 375); equal(pay(30000), 450); });
test('over $30,000: 2% of the whole day', () => { equal(pay(30000.01), 600.0); equal(pay(40000), 800); });
test('a negative or empty day pays nothing, never a debt', () => { equal(pay(-500), 0); equal(pay(null), 0); });
test('a payment of exactly one cent over the line crosses it', () => { equal(tieredCommission(10000.01).pct, 1); equal(tieredCommission(10000).pct, 0); });

suite('commission tiers — the agreement’s example');

test('with the $30,000 line inclusive, a $30,000 day earns $600 (the example)', () => {
  equal(pay(30000, inclusive30), 600); equal(pay(25000, inclusive30), 375); equal(pay(15000, inclusive30), 150); equal(pay(9000, inclusive30), 0);
});

suite('commission tiers — settings and the next tier');

test('tiers from settings are cleaned and sorted; junk falls back to the default', () => {
  equal(normalizeTiers([{ over: 20000, pct: 3 }, { over: 'x', pct: 1 }, { over: 10000, pct: 1 }]).map((t) => t.over), [10000, 20000]);
  equal(normalizeTiers(null).map((t) => t.pct), DEFAULT_TIERS.map((t) => t.pct));
  equal(normalizeTiers([{ over: 1, pct: 500 }]).length, 3, 'an impossible rate is thrown out');
});

test('how far to the next tier, and what crossing it pays', () => {
  const n = nextTier(8000);
  equal(n.pct, 1); equal(n.moreNeeded, 2000.01); equal(n.wouldPay, 100);
  const m = nextTier(19000); equal(m.pct, 1.5); equal(m.moreNeeded, 1000.01); equal(m.wouldPay, 300);
  equal(nextTier(50000), null, 'nothing above the top tier');
  equal(nextTier(29999, inclusive30).moreNeeded, 1, 'an inclusive line needs exactly the line');
});

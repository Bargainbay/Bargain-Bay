import { suite, test, equal } from './_harness.mjs';
import { newPriceFor, resolveTyped } from '../lib/price-math.js';

suite('lib/price-math — the Pricing screen changes prices by percent and by dollars');

const facts = { cost: 600, retail: 2000 };

test('percentage up and down', () => {
  equal(newPriceFor(1000, facts, 'pct', 5), 1050);
  equal(newPriceFor(1000, facts, 'pct', -10), 900);
});

test('dollars up and down', () => {
  equal(newPriceFor(1000, facts, 'usd', 50), 1050);
  equal(newPriceFor(1000, facts, 'usd', -25), 975);
});

test('cost plus a percentage, and a percentage of retail', () => {
  equal(newPriceFor(1000, facts, 'markup', 30), 780);
  equal(newPriceFor(1000, facts, 'retail', 70), 1400);
});

test('units with no cost or no retail are skipped, never guessed', () => {
  equal(newPriceFor(1000, { cost: 0, retail: 2000 }, 'markup', 30), null);
  equal(newPriceFor(1000, { cost: 600, retail: 0 }, 'retail', 70), null);
});

test('rounding to whole dollars, and never a zero or negative price', () => {
  equal(newPriceFor(999.5, facts, 'pct', 5, 'dollar'), 1049);
  equal(newPriceFor(100, facts, 'usd', -150), null);
});

test('typed price boxes: a number, a signed percent, a signed dollar amount', () => {
  equal(resolveTyped('899', 1000), 899);
  equal(resolveTyped('$1,049.50', 1000), 1049.5);
  equal(resolveTyped('+5%', 1000), 1050);
  equal(resolveTyped('-10%', 1000), 900);
  equal(resolveTyped('+50', 1000), 1050);
  equal(resolveTyped('-25', 1000), 975);
});

test('an unsigned percent is ambiguous and is refused; nonsense is refused', () => {
  equal(resolveTyped('5%', 1000), null);
  equal(resolveTyped('abc', 1000), null);
  equal(resolveTyped('', 1000), null);
  equal(resolveTyped('-2000', 1000), null);
});

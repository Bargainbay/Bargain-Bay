// The Black Friday lots: a unit that sells stays on the hero as a SOLD slide; a model with more units left has not sold out.
import { suite, test, assert, equal } from './_harness.mjs';
import { chooseLots, lotsToSlides, firstLive } from '../lib/bf-lots.js';

const u = (id, make, model, category, price, compareAt) => ({ id, make, model, category, price, compareAt, title: `${make} ${model}`, image: `https://x.test/${id}.jpg`, condition: 'New Scratch & Dent' });

suite('black friday lots');
const stock = [
  u('F1', 'Whirlpool', 'WRS', 'Refrigerator', 712, 1695),
  u('W1', 'Electrolux', 'EFLS', 'Washer', 799, 1343),
  u('R1', 'Cafe', 'CHS', 'Range', 1499, 2499),
  u('D1', 'Maytag', 'MED', 'Dryer', 777, 1295)
];

test('lots are frozen snapshots of the real picks, in markdown order', () => {
  const lots = chooseLots(stock, 4);
  equal(lots.length, 4);
  equal(lots[0].sku, 'F1');
  equal(lots[0].price, 712); equal(lots[0].compareAt, 1695);
});

test('a lot still for sale is a live slide with its real percent off', () => {
  const slides = lotsToSlides(chooseLots(stock, 4), stock);
  assert(slides.every((s) => !s.sold));
  equal(slides[0].pct, 58);
  equal(slides[0].id, 'F1');
});

test('a unit that sells stays as a SOLD slide drawn from its snapshot, in the same place', () => {
  const lots = chooseLots(stock, 4);
  const slides = lotsToSlides(lots, stock.filter((x) => x.id !== 'F1'));
  equal(slides.length, 4);
  equal(slides[0].sold, true);
  equal(slides[0].price, 712); equal(slides[0].was, 1695);
  equal(slides[0].image, 'https://x.test/F1.jpg');
  equal(slides[1].sold, false);
});

test('a model with another unit left has NOT sold out: the slide moves to the next unit', () => {
  const lots = chooseLots(stock, 4);
  const live = [...stock.filter((x) => x.id !== 'F1'), u('F2', 'Whirlpool', 'WRS', 'Refrigerator', 749, 1695)];
  const slides = lotsToSlides(lots, live);
  equal(slides[0].sold, false); equal(slides[0].id, 'F2'); equal(slides[0].left, 1);
});

test('opens on the first slide still for sale, never on a sold one', () => {
  const slides = lotsToSlides(chooseLots(stock, 4), stock.filter((x) => x.id !== 'F1'));
  equal(firstLive(slides), 1);
  equal(firstLive([]), 0);
});

test('nothing chosen means no slides', () => {
  equal(lotsToSlides([], stock).length, 0);
  equal(chooseLots([], 4).length, 0);
});

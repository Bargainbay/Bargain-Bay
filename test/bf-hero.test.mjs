// The Black Friday hero's numbers come from the live catalogue; these pin that they are honest.
import { suite, test, assert, equal } from './_harness.mjs';
import { pickDoorbusters, topOffPct, endOfTorontoDayMs } from '../lib/bf-hero.js';

const u = (id, make, model, category, price, compareAt, extra = {}) => ({ id, make, model, category, price, compareAt, image: `https://x.test/${id}.jpg`, ...extra });

suite('black friday hero');
test('the headline percentage is the deepest REAL markdown on our own stock, and ignores sellers and Vesta', () => {
  const units = [
    u('A', 'Whirlpool', 'W1', 'Washer', 399, 1099),                       // 64%
    u('B', 'LG', 'L1', 'Range', 900, 1000),                              // 10%
    u('V', 'Seller', 'S1', 'Range', 100, 1000, { vendor: { id: 7 } }),   // 90%: a seller's, must not count
    u('VS-12', 'Vesta', 'K1', 'Range', 50, 1000)                         // 95%: Vesta's range, must not count
  ];
  equal(topOffPct(units), 64);
  equal(topOffPct([]), 0);
});

test('cards: biggest markdowns first, one per model, a spread of appliance types, real photos and real retail only', () => {
  const units = [
    u('W1', 'Whirlpool', 'WFW', 'Washer', 399, 1099), u('W2', 'Whirlpool', 'WFW', 'Washer', 449, 1099),   // same model twice
    u('W3', 'Amana', 'NFW', 'Washer', 399, 949),
    u('F1', 'Frigidaire', 'FRT', 'Refrigerator', 712, 1695),
    u('R1', 'Fulgor', 'SOF', 'Range', 2999, 7969),
    u('D1', 'Samsung', 'DVE', 'Dryer', 540, 1199),
    u('X1', 'Cheap', 'C1', 'Microwave', 40, 150),                                  // retail under $500
    u('X2', 'Meh', 'M1', 'Washer', 900, 1000),                                     // only 10% off
    { ...u('X3', 'NoPic', 'P1', 'Washer', 300, 1500), image: '/stock/washer.svg' } // placeholder art
  ];
  const picks = pickDoorbusters(units, 4);
  equal(picks.length, 4);
  equal(picks[0].rep.id, 'W1');                                  // 64% off, and the CHEAPEST unit of that model is the one shown
  equal(picks[0].count, 2); equal(picks[0].minPrice, 399);       // "2 available, from $399"
  const types = picks.map((p) => p.rep.category);
  equal(new Set(types).size, 4, 'four different appliance types before any repeats: ' + types);
  assert(!picks.some((p) => ['X1', 'X2', 'X3'].includes(p.rep.id)), 'junk and placeholders are never headlined');
  assert(picks.every((p) => p.pct >= 30));
});

test('with fewer good units than cards it shows what it has, and an empty catalogue shows none', () => {
  equal(pickDoorbusters([u('A', 'W', 'M', 'Washer', 399, 1099)], 4).length, 1);
  equal(pickDoorbusters([], 4).length, 0);
});

test('the countdown ends at 23:59:59 Toronto time on the last day, in EST and in EDT', () => {
  equal(new Date(endOfTorontoDayMs('2026-11-30')).toISOString(), '2026-12-01T04:59:59.000Z');   // EST, UTC-5
  equal(new Date(endOfTorontoDayMs('2026-07-15')).toISOString(), '2026-07-16T03:59:59.000Z');   // EDT, UTC-4
  equal(endOfTorontoDayMs('nonsense'), null);
});

test('refurbished units are not in the Black Friday sale: not a card, not the headline percentage', () => {
  const units = [
    u('R1', 'Whirlpool', 'WFW', 'Washer', 399, 1099, { condition: 'Refurbished' }),          // 64%: the deepest, but refurbished
    u('N1', 'Whirlpool', 'WRS', 'Refrigerator', 712, 1695, { condition: 'New Scratch & Dent' }), // 58%
    u('N2', 'JennAir', 'JWD', 'Warming drawer', 671, 1399, { condition: 'New Open Box' })       // 52%
  ];
  equal(topOffPct(units), 58, 'the headline is the deepest NON-refurbished markdown');
  const picks = pickDoorbusters(units, 4);
  equal(picks.map((p) => p.rep.id), ['N1', 'N2']);
  assert(!picks.some((p) => p.rep.condition === 'Refurbished'));
  equal(topOffPct([units[0]]), 0);
});

test('major appliances come before accessories: a warming drawer or a range hood only fills a card when there are not enough majors', () => {
  const units = [
    u('H1', 'Electrolux', 'EH', 'Range Hood', 620, 1148),                 // 46%, an accessory
    u('D1', 'JennAir', 'JWD', 'Warming Drawer', 671, 1399),               // 52%, an accessory
    u('F1', 'Whirlpool', 'WRS', 'Refrigerator', 712, 1695),               // 58%
    u('W1', 'Electrolux', 'EFLS', 'Washer', 799, 1343),                   // 41%
    u('F2', 'Frigidaire', 'FRS', 'Refrigerator', 957, 1993)               // 52%
  ];
  equal(pickDoorbusters(units, 3).map((p) => p.rep.id), ['F1', 'W1', 'F2'], 'majors first, then the deepest accessory only if short');
  equal(pickDoorbusters(units, 4).map((p) => p.rep.id), ['F1', 'W1', 'F2', 'D1']);
});

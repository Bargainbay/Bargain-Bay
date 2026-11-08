// lib/quote-profit.js — live profit on a quote.
//
// THE WORKED EXAMPLE IN THE SPEC (Addendum 1 section B) PRINTS THE WRONG PROFITS, and this
// test pins the correct ones. The spec: "$2,000 sold, $1,550 cost -> profit $350" — but
// 2,000 - 1,550 is 450, and the owner confirmed (2026-11-08) that $1,550 is the cost. The
// two figures after it carry the same $100 slip. Correct: 450, then 355 with delivery and
// haul-away included (450 - 75 - 20), then 455 with delivery switched to charged at $100.
import { suite, test, equal } from './_harness.mjs';
import { quoteProfit, profitLabel, costUnits } from '../lib/quote-profit.js';

const fridge = { amount: 2000, cost: 1550, isUnit: true };
const DELIVERY = { name: 'Delivery', internalCost: 75, costBasis: 'order', qty: 1 };
const HAUL = { name: 'Haul-away', internalCost: 20, costBasis: 'unit', qty: 1 };

suite('quote profit — the worked example');

test('a bare unit: price less cost', () => equal(quoteProfit({ lines: [fridge] }).profit, 450));

test('delivery and haul-away INCLUDED: only their internal cost comes off', () => {
  const p = quoteProfit({ lines: [fridge], services: [{ ...DELIVERY, mode: 'included' }, { ...HAUL, mode: 'included' }] });
  equal(p.profit, 355); equal(p.serviceCost, 95); equal(p.revenue, 2000);
});

test('delivery switched to CHARGED at $100: revenue +100, its cost still comes off', () => {
  const p = quoteProfit({ lines: [fridge], services: [{ ...DELIVERY, mode: 'charged', price: 100 }, { ...HAUL, mode: 'included' }] });
  equal(p.profit, 455); equal(p.revenue, 2100);
});

suite('quote profit — flags, units, holes');

test('yellow under $100, red under $0, never blocks', () => {
  equal(quoteProfit({ lines: [{ amount: 1000, cost: 950 }] }).level, 'low');
  equal(quoteProfit({ lines: [{ amount: 1000, cost: 900 }] }).level, 'ok');
  equal(quoteProfit({ lines: [{ amount: 1000, cost: 1100 }] }).level, 'loss');
  equal(profitLabel(quoteProfit({ lines: [{ amount: 1000, cost: 950 }] })), 'Low profit: $50.00');
  equal(profitLabel(quoteProfit({ lines: [{ amount: 1000, cost: 1100 }] })), 'Loss: $100.00');
  equal(quoteProfit({ lines: [{ amount: 1000, cost: 950 }], threshold: 40 }).level, 'ok', 'threshold is a setting');
});

test('per-unit services scale with the number of appliances; per-order does not', () => {
  const two = [fridge, { amount: 800, cost: 500 }];
  const p = quoteProfit({ lines: two, services: [{ ...HAUL, mode: 'included', qty: 1 }, { ...DELIVERY, mode: 'included' }] });
  equal(p.serviceCost, 75 + 40);
  equal(costUnits({ costBasis: 'hour', qty: 3 }), 3);
});

test('a cost nobody entered is reported, not treated as free', () => {
  const p = quoteProfit({ lines: [{ amount: 500, cost: null }], services: [{ name: 'Install', mode: 'included', internalCost: null, costBasis: 'appliance', qty: 1 }] });
  equal(p.missing.units, 1); equal(p.missing.services, 1);
});

test('bundle discount and a cash deal change revenue; the cash deal comes back out of HST', () => {
  equal(quoteProfit({ lines: [fridge], bundlePct: 10 }).revenue, 1800);
  const cash = quoteProfit({ lines: [fridge], cashTotal: 2260, addHst: true });
  equal(cash.revenue, 2000); equal(cash.profit, 450);
  equal(quoteProfit({ lines: [fridge], cashTotal: 2000, addHst: false }).revenue, 2000);
});

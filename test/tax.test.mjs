// lib/tax.js — backing HST out of a price that already includes it.
//
// "Twelve hundred out the door" has to become $1,061.95 + $138.05 on an
// invoice, because an HST registrant must state the tax separately. Roughly one
// cent-value in eight has no exact 13% split, so something has to give, and the
// module's rule is that THE QUOTED TOTAL ALWAYS WINS: the customer was told
// $1,200 and will hand over $1,200, so the residue goes in the tax line rather
// than in the total.
//
// These tests are mostly INVARIANTS rather than examples, because the failure
// mode here is not "this one price is wrong" — it is "some price out of the
// eight hundred thousand a shop quotes in a year comes out a cent off and
// nobody can explain the invoice."
import { suite, test, assert, equal } from './_harness.mjs';
import { exTaxOf, inclusiveOf, splitGross, splitTaxInclusive, toInclusiveLines } from '../lib/tax.js';
import { round2, HST_RATE } from '../lib/constants.js';

// Every cent from $0.00 to $2,000, which covers essentially every appliance
// this shop sells. Cheap enough to run on every commit (~200k iterations).
function everyCent(upTo = 200000, fn) {
  for (let c = 0; c <= upTo; c++) fn(c / 100);
}

suite('lib/tax — the quoted total always wins');

test('the documented examples come out exactly as written down', () => {
  // These are in CLAUDE.md and in the module header. If one moves, the
  // documentation is wrong and somebody should find out from a red test.
  equal(exTaxOf(1200), 1061.95, '"twelve hundred out the door"');
  equal(round2(1200 - exTaxOf(1200)), 138.05, 'and its HST');
  equal(exTaxOf(800), 707.96, '$800 has no exact split; this is the closest');
  equal(round2(800 - exTaxOf(800)), 92.04);
  equal(exTaxOf(100), 88.50);
});

test('INVARIANT: subtotal + HST equals the quote exactly, for every cent to $2,000', () => {
  // The one that matters. A customer quoted $800 must never receive an invoice
  // for $799.99 that nobody can account for.
  let broken = [];
  everyCent(200000, (quoted) => {
    const sub = exTaxOf(quoted);
    if (round2(sub + round2(quoted - sub)) !== quoted) broken.push(quoted);
  });
  equal(broken.slice(0, 5), [], `${broken.length} values did not add back to the quote`);
});

test('the subtotal chosen is the closest one to a true 13%', () => {
  // Not merely *a* subtotal that adds back — the best one. A cent either side
  // would also add back, so this is what stops the answer drifting.
  everyCent(20000, (quoted) => {
    if (!quoted) return;
    const chosen = exTaxOf(quoted);
    const errOf = (c) => Math.abs(round2(quoted - c) - c * HST_RATE);
    for (const other of [round2(chosen - 0.01), round2(chosen + 0.01)]) {
      assert(errOf(chosen) <= errOf(other) + 1e-9,
        `at ${quoted}: chose ${chosen} but ${other} was closer to a true 13%`);
    }
  });
});

test('a dead tie states MORE tax, never less', () => {
  // A part-cent over-remitted is a rounding note. Under-remitted is a shortfall
  // owed to the CRA, and that is the asymmetry worth encoding.
  everyCent(20000, (quoted) => {
    if (!quoted) return;
    const chosen = exTaxOf(quoted);
    const err = (c) => round2(quoted - c) - c * HST_RATE;
    const lower = round2(chosen - 0.01);
    // If the cent below is EXACTLY as close, it should have been preferred only
    // when it states more tax. (A lower subtotal leaves more tax behind.)
    if (Math.abs(Math.abs(err(lower)) - Math.abs(err(chosen))) < 1e-9) {
      assert(err(chosen) >= err(lower) - 1e-9,
        `at ${quoted}: tie broken towards the smaller tax`);
    }
  });
});

test('zero and nonsense are zero, not NaN', () => {
  equal(exTaxOf(0), 0);
  equal(exTaxOf(null), 0);
  equal(exTaxOf(undefined), 0);
  equal(exTaxOf(''), 0);
  equal(exTaxOf('not a number'), 0);
});

suite('lib/tax — splitGross, for money that already moved');

test('INVARIANT: cost + tax equals the gross exactly, for every cent to $2,000', () => {
  // A bank line or a receipt total is a FACT. The two halves must add back to
  // it or the expense ledger disagrees with the bank.
  let broken = [];
  everyCent(200000, (gross) => {
    const r = splitGross(gross);
    if (round2(r.cost + r.tax) !== gross) broken.push(gross);
  });
  equal(broken.slice(0, 5), [], `${broken.length} values did not add back to the gross`);
});

test('gross is echoed back rounded, so callers can trust one number', () => {
  equal(splitGross(56.78).gross, 56.78);
  equal(splitGross(0).gross, 0);
  equal(splitGross(null).cost, 0);
});

// This one is a PIN, not a rule. See the note below.
test('splitGross and exTaxOf currently agree at every rate — pinned deliberately', () => {
  // lib/tax says these answer different questions, and their CALLERS certainly
  // do: exTaxOf honours a price somebody was quoted, splitGross divides a
  // charge that already happened. But empirically, at every rate this business
  // might use, the three-candidate search in exTaxOf never beats splitGross's
  // naive division — they return the same number every time.
  //
  // So this is pinned rather than asserted as a law. If Phase 3.6's
  // multi-jurisdiction work introduces a rate where they diverge, this test
  // goes red and somebody gets to decide which surface should change, instead
  // of finding out from an invoice.
  for (const rate of [0.05, 0.07, 0.09975, 0.13, 0.15]) {
    for (let c = 1; c <= 20000; c++) {
      const g = c / 100;
      equal(exTaxOf(g, rate), splitGross(g, rate).cost,
        `diverged at rate ${rate}, value ${g} — see the comment on this test`);
    }
  }
});

suite('lib/tax — splitting a tax-inclusive invoice');

test('the total is the sum of what was typed, to the cent, always', () => {
  for (const amounts of [[1000, 200], [100, 100], [100.01, 99.99], [1200],
                         [899.99, 45, 120.5], [33.33, 33.33, 33.34], [5000, 250, 75]]) {
    const r = splitTaxInclusive(amounts);
    equal(r.total, round2(amounts.reduce((a, n) => a + n, 0)),
      `total drifted from the quote for ${JSON.stringify(amounts)}`);
    equal(round2(r.subtotal + r.hst), r.total, 'subtotal + HST must equal the total');
    equal(round2(r.lines.reduce((a, n) => a + n, 0)), r.subtotal,
      'the pre-tax lines must add to the subtotal');
  }
});

test('a credit line is part of the quote, not an exception to it', () => {
  // A discount or trade-in quoted tax-in is just a negative amount.
  const r = splitTaxInclusive([1000, -50]);
  equal(r.total, 950);
  equal(round2(r.subtotal + r.hst), 950);
  equal(round2(r.lines.reduce((a, n) => a + n, 0)), r.subtotal);
  assert(r.lines[1] < 0, 'the credit line stays negative');
});

test('reopening and re-saving an untouched invoice moves nothing', () => {
  // The rep sees the figures they typed, not a re-derivation. Saving again must
  // not shuffle money — that is how a total somebody quoted out loud drifts.
  for (const amounts of [[1000, 200], [100, 100], [100.01, 99.99], [1200], [1000, -50],
                         [899.99, 45, 120.5], [33.33, 33.33, 33.34], [5000, 250, -100, 75]]) {
    const stored = splitTaxInclusive(amounts);
    const shown = toInclusiveLines(stored.lines, stored.total);
    const resaved = splitTaxInclusive(shown);
    equal(resaved.lines, stored.lines, `lines moved on re-save for ${JSON.stringify(amounts)}`);
    equal(resaved.total, stored.total, 'total moved on re-save');
    equal(resaved.hst, stored.hst, 'HST moved on re-save');
  }
});

test('per-line cents are NOT recoverable, and that is the documented trade', () => {
  // [100,100] and [100.01,99.99] back out to the same pre-tax subtotal, so
  // reopening may shuffle a cent between lines. The TOTAL is what was quoted
  // out loud and the total is stable. Storing the typed figures as well would
  // be a second representation of the same money — see the coupon landmine.
  const a = splitTaxInclusive([100, 100]);
  const b = splitTaxInclusive([100.01, 99.99]);
  equal(a.subtotal, b.subtotal, 'same subtotal');
  equal(a.total, b.total, 'same total');
  equal(toInclusiveLines(a.lines, a.total), [99.99, 100.01], 'a cent moves between lines');
});

test('empty and zero inputs do not explode', () => {
  const r = splitTaxInclusive([]);
  equal(r.lines, []);
  equal(r.total, 0);
  equal(r.subtotal, 0);
  equal(r.hst, 0);
  equal(splitTaxInclusive([0, 0]).total, 0);
});

suite('lib/tax — inclusiveOf / toInclusiveLines');

test('inclusiveOf is the plain forward direction', () => {
  equal(inclusiveOf(100), 113);
  equal(inclusiveOf(1061.95), 1200);
  equal(inclusiveOf(0), 0);
});

test('toInclusiveLines sums to the total it is given', () => {
  for (const [lines, total] of [[[884.96, 176.99], 1200], [[88.49, 88.5], 200],
                                [[4424.78, 221.24, -88.5, 66.37], 5225]]) {
    const out = toInclusiveLines(lines, total);
    equal(round2(out.reduce((a, n) => a + n, 0)), total,
      `did not sum to ${total} for ${JSON.stringify(lines)}`);
  }
});

test('with no total given it just adds tax to each line', () => {
  equal(toInclusiveLines([100, 200]), [113, 226]);
  equal(toInclusiveLines([]), []);
  equal(toInclusiveLines([], 500), []);
});

// Backing tax OUT of a price that already includes it.
//
// The shop quotes both ways. "Twelve hundred out the door" is a tax-INCLUSIVE
// figure, and an invoice has to show it as $1,061.95 + $138.05 HST, because an
// HST registrant must state the tax separately. This module does that split and
// nothing else — it is pure arithmetic, used by the server (which is
// authoritative) and by the forms (which only preview what the server will do).
//
// THE AWKWARD PART: 13% of a rounded subtotal doesn't always add back up to the
// figure that was quoted. $800 out the door has no exact split — $707.96 +
// $92.03 is a cent under, $707.97 + $92.04 a cent over. Roughly one cent-value
// in eight is unreachable that way.
//
// The quoted price wins. It is what the customer was told and what they will
// hand over, so the total is ALWAYS the quote exactly and the HST is whatever
// is left once the subtotal comes out of it. That puts the unavoidable rounding
// in the tax line, half a cent off a true 13%, instead of in the total, where a
// customer quoted $800 gets an invoice for $799.99 and nobody can say why.
// (Half a cent on a tax line is ordinary; the CRA cares that the invoice states
// the tax and adds up, not that it survives a 13% recomputation.)
import { HST_RATE, round2 } from './constants';

// The pre-tax amount behind a tax-inclusive figure: the subtotal whose leftover
// tax — quoted minus subtotal — sits closest to a true 13% of it.
export function exTaxOf(inclusive, rate = HST_RATE) {
  const quoted = round2(Number(inclusive) || 0);
  if (!quoted) return 0;
  const guess = round2(quoted / (1 + rate));
  let best = guess;
  let bestScore = null;
  // The true answer is within a cent of the naive division either way, so three
  // candidates is the whole search space.
  for (const cand of [guess, round2(guess - 0.01), round2(guess + 0.01)]) {
    // The tax this subtotal leaves behind, against a true (unrounded) 13% of it.
    const err = round2(quoted - cand) - cand * rate;
    // Closest first; on a dead tie, the one that states the MORE tax — a part-
    // cent over-remitted is a rounding note, under-remitted is a shortfall.
    const score = [Math.abs(err), err > 0 ? 0 : 1];
    if (!bestScore || score[0] < bestScore[0] - 1e-9
      || (Math.abs(score[0] - bestScore[0]) < 1e-9 && score[1] < bestScore[1])) {
      best = cand;
      bestScore = score;
    }
  }
  return best;
}

// The reverse: what a pre-tax amount comes to with tax on top.
export function inclusiveOf(exTax, rate = HST_RATE) {
  const n = round2(Number(exTax) || 0);
  return round2(n + round2(n * rate));
}

// Split ONE known gross charge into cost and tax — a bank line, a receipt total.
//
// Deliberately NOT exTaxOf. That one answers a different question ("what
// subtotal, taxed, gives the price I quoted?") and will happily land a cent off
// the quote when no exact split exists. Here the gross is a fact that already
// happened, so the only rule that matters is that the two halves add back to it
// exactly. bulkSetExpenseTax in lib/finance.js does the same arithmetic in SQL —
// keep the two in step or the review screen previews a figure it won't produce.
export function splitGross(gross, rate = HST_RATE) {
  const g = round2(Number(gross) || 0);
  const cost = round2(g / (1 + rate));
  return { cost, tax: round2(g - cost), gross: g };
}

// Split a set of tax-INCLUSIVE line amounts into pre-tax line amounts.
//
// The subtotal is derived from the QUOTED TOTAL, not from the sum of
// per-line divisions: dividing each line separately and adding them up drifts,
// and the number the customer was told is the total, so that is the one that has
// to be honoured. The rounding residue is then pushed onto the largest lines so
// the parts still add up to the whole.
//
// `total` is the quote, exactly, always — never a recomputed subtotal + 13%.
// `hst` is the remainder, which is what makes that possible.
//
// Handles negative amounts (a discount or trade-in quoted tax-in) unchanged —
// they are simply part of the quoted total.
export function splitTaxInclusive(amounts, rate = HST_RATE) {
  const nums = (amounts || []).map((n) => round2(Number(n) || 0));
  const quoted = round2(nums.reduce((a, n) => a + n, 0));
  const subtotal = exTaxOf(quoted, rate);
  const lines = nums.map((n) => round2(n / (1 + rate)));

  // Spread the difference a cent at a time over the biggest lines, which is
  // where a cent is least visible.
  let residue = Math.round((subtotal - lines.reduce((a, n) => a + n, 0)) * 100);
  if (residue !== 0 && lines.length) {
    const biggestFirst = lines.map((v, i) => i).sort((a, b) => Math.abs(nums[b]) - Math.abs(nums[a]));
    const step = residue > 0 ? 0.01 : -0.01;
    for (let k = 0; residue !== 0; k++) {
      const i = biggestFirst[k % biggestFirst.length];
      lines[i] = round2(lines[i] + step);
      residue += residue > 0 ? -1 : 1;
    }
  }

  // NOT round2(subtotal * rate): on the ~1 price in 8 with no exact 13% split
  // that lands the invoice a cent off the price the customer was quoted.
  const hst = round2(quoted - subtotal);
  return { lines, subtotal, hst, total: quoted, quoted, residual: 0 };
}

// Pre-tax line amounts → the tax-inclusive figures to show in a form, summing to
// `total` when one is given (the invoice's own stored total). Used when reopening
// an invoice that was quoted tax-in, so the rep sees the numbers they typed.
export function toInclusiveLines(exAmounts, total = null, rate = HST_RATE) {
  const lines = (exAmounts || []).map((n) => inclusiveOf(n, rate));
  if (total == null || !lines.length) return lines;
  let residue = Math.round((round2(Number(total) || 0) - lines.reduce((a, n) => a + n, 0)) * 100);
  if (residue === 0) return lines;
  const biggestFirst = lines.map((v, i) => i).sort((a, b) => Math.abs(lines[b]) - Math.abs(lines[a]));
  const step = residue > 0 ? 0.01 : -0.01;
  for (let k = 0; residue !== 0; k++) {
    const i = biggestFirst[k % biggestFirst.length];
    lines[i] = round2(lines[i] + step);
    residue += residue > 0 ? -1 : 1;
  }
  return lines;
}

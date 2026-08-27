// Backing tax OUT of a price that already includes it.
//
// The shop quotes both ways. "Twelve hundred out the door" is a tax-INCLUSIVE
// figure, and an invoice has to show it as $1,061.95 + $138.05 HST, because an
// HST registrant must state the tax separately. This module does that split and
// nothing else — it is pure arithmetic, used by the server (which is
// authoritative) and by the forms (which only preview what the server will do).
//
// THE AWKWARD PART: 13% of a rounded subtotal doesn't always add back up to the
// figure that was quoted. A $100 inclusive price has no exact split at all —
// $88.50 + $11.51 is a cent over, $88.49 + $11.50 a cent under. Roughly one
// cent-value in eight is unreachable. So the split picks whichever subtotal
// reconstructs the quote most closely, prefers to be a cent UNDER rather than
// over when it can't be exact, and reports the residual so a caller can show it
// rather than let it appear as a mystery.
import { HST_RATE, round2 } from './constants';

// The pre-tax amount behind a tax-inclusive figure.
export function exTaxOf(inclusive, rate = HST_RATE) {
  const quoted = round2(Number(inclusive) || 0);
  if (!quoted) return 0;
  const guess = round2(quoted / (1 + rate));
  let best = guess;
  let bestScore = null;
  // The true answer is within a cent of the naive division either way, so three
  // candidates is the whole search space.
  for (const cand of [guess, round2(guess - 0.01), round2(guess + 0.01)]) {
    const err = round2(round2(cand + round2(cand * rate)) - quoted);
    // Closest first; on a tie, the one that doesn't overcharge the customer.
    const score = [Math.abs(err), err > 0 ? 1 : 0];
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

  const hst = round2(subtotal * rate);
  const total = round2(subtotal + hst);
  return { lines, subtotal, hst, total, quoted, residual: round2(total - quoted) };
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

// Recording a purchase invoice whose stock is ALREADY on the tracker.
//
// The hole this closes: RS Ops books a delivery in by hand, the supplier's
// paperwork arrives days later, and by then those rows no longer say NEEDS
// INVOICE. The upload path matches nothing, so committing would add every
// appliance a second time — and the invoice's HST, which is recoverable money,
// had nowhere to go at all. On 2026-09-28 that was $902.60 across five
// invoices.
//
// The reconciliation here is the other half. A parser took each invoice's TAX
// figure as its last line's cost on all five, and every individual number still
// looked plausible — a dishwasher at $258.08 is not obviously wrong. Summing the
// units against the subtotal catches it in one line.
import { suite, test, assert, equal } from './_harness.mjs';
import { sameInvoiceNumber, invoiceCostProblem, isWaitingForInvoice, invoiceCellBlocked, modelsMatch, isHaulAway, isHaulAwayLot } from '../lib/stock-match.js';

suite('purchase invoice — header-only record');

test('THE SAME INVOICE SPELLED TWO WAYS IS ONE INVOICE', () => {
  assert(sameInvoiceNumber('PS-INV117036', 'ps-inv117036'), 'case must not matter');
  assert(sameInvoiceNumber('PS-INV117036', 'PS INV 117036'), 'punctuation must not matter');
  assert(sameInvoiceNumber(' PS-INV117036 ', 'PSINV117036'), 'spacing must not matter');
});

test('A DIFFERENT INVOICE IS A DIFFERENT INVOICE', () => {
  assert(!sameInvoiceNumber('PS-INV117036', 'PS-INV117037'), 'one digit apart is another delivery');
  assert(!sameInvoiceNumber('PS-INV117125', 'PS-INV117126'), 'consecutive numbers are not the same');
});

test('IT IS NOT A SUBSTRING TEST', () => {
  // "117036" appearing inside a longer number would otherwise claim it, and a
  // wrong match here puts one delivery's tax against another's stock.
  assert(!sameInvoiceNumber('117036', 'PS-INV1170361'), 'must not match a longer number');
  assert(!sameInvoiceNumber('PS-INV117036', 'PS-INV117036-A'), 'a suffix is a different reference');
});

test('EMPTY MATCHES NOTHING, INCLUDING OTHER EMPTIES', () => {
  // Otherwise every blank Invoice cell on the tracker joins the first invoice
  // anybody records.
  assert(!sameInvoiceNumber('', ''), 'blank must not match blank');
  assert(!sameInvoiceNumber(null, undefined), 'nullish must not match');
  assert(!sameInvoiceNumber('   ', 'PS-INV117036'), 'whitespace is not a number');
  assert(!sameInvoiceNumber('---', '   '), 'punctuation-only normalises to empty');
});

test('A ROW STILL WAITING NAMES THE INVOICE WITHOUT BELONGING TO IT', () => {
  // The cell reads "NEEDS INVOICE (lot name says PS-INV117036)". It mentions the
  // number, carries no cost, and must never be counted — it would drag the
  // reconciliation under the subtotal and make a correct invoice look wrong.
  const cell = 'NEEDS INVOICE (lot name says PS-INV117036)';
  assert(isWaitingForInvoice(cell), 'that cell is a waiting row');
  assert(!sameInvoiceNumber(cell, 'PS-INV117036'), 'and it is not this invoice');
});

suite('purchase invoice — the cost must add up to the subtotal');

test('COSTS THAT MATCH THE SUBTOTAL RAISE NOTHING', () => {
  equal(invoiceCostProblem(1260.50, 1260.50, { count: 6 }), '', 'an invoice that reconciles is silent');
});

test('A CENT EITHER WAY IS ROUNDING, NOT AN ERROR', () => {
  equal(invoiceCostProblem(1260.52, 1260.50, { count: 6 }), '', 'two cents over is tolerated');
  equal(invoiceCostProblem(1260.48, 1260.50, { count: 6 }), '', 'two cents under is tolerated');
});

test('THE REAL 2026-09-28 ERROR IS CAUGHT', () => {
  // PS-INV117036: the last line was given the invoice's tax ($163.87) as its
  // cost instead of $323.75, so the units summed $159.88 short.
  const msg = invoiceCostProblem(1100.62, 1260.50, { count: 6 });
  assert(msg, 'a $159.88 gap must be reported');
  assert(msg.includes('159.88'), `the message should name the gap: ${msg}`);
  assert(msg.includes('less'), 'and say which way it is out');
});

test('COSTING MORE THAN THE INVOICE IS ALSO WRONG', () => {
  const msg = invoiceCostProblem(1500, 1260.50, { count: 6 });
  assert(msg.includes('more'), `an overshoot must say "more": ${msg}`);
});

test('NO UNITS MEANS NOTHING TO RECONCILE', () => {
  // An invoice whose stock is not on the tracker at all is still worth
  // recording for its tax — it must not be blocked by a check it cannot pass.
  equal(invoiceCostProblem(0, 1260.50, { count: 0 }), '', 'zero units raises nothing');
});

test('NO SUBTOTAL MEANS NOTHING TO RECONCILE AGAINST', () => {
  equal(invoiceCostProblem(1260.50, '', { count: 6 }), '', 'a blank subtotal is not a mismatch');
  equal(invoiceCostProblem(1260.50, 0, { count: 6 }), '', 'a zero subtotal is not a mismatch');
});

test('THE MESSAGE SAYS WHAT TO DO ABOUT IT', () => {
  // It ends up in front of somebody about to claim a credit on a government
  // return, so it has to say that one of the two figures is wrong.
  const msg = invoiceCostProblem(1100.62, 1260.50, { count: 6 });
  assert(/before claiming the tax/i.test(msg), `must warn against claiming: ${msg}`);
});

suite('purchase invoice — correcting which invoice a unit came in on');

test('A NOTE SOMEBODY TYPED IS NOT A CLAIM ON THE ROW', () => {
  // The real cell on the 21 Bertazzoni/Fulgor rows, before PS-INV117078 was
  // known. It names a spreadsheet, not an invoice, so it is replaceable.
  const cell = 'Supplier list Bertazzoni_Fulgor_Inventory.xlsx (no invoice sent) - cost = list Sell Price';
  equal(invoiceCellBlocked(cell, 'PS-INV117078'), '', 'a note must not block the correction');
  equal(invoiceCellBlocked('', 'PS-INV117078'), '', 'an empty cell is writable');
  equal(invoiceCellBlocked('CONSIGNMENT', 'PS-INV117078'), '', 'a consignment marker is not an invoice number');
});

test('A ROW NAMING ANOTHER INVOICE IS REFUSED, AND SAYS WHICH', () => {
  // Overwriting it moves that delivery's stock onto this invoice's paperwork.
  // This is the S-ORD115612 / PS-INV116968 tangle, and it was silent.
  const msg = invoiceCellBlocked('PS-INV116968', 'PS-INV117078');
  assert(msg, 'another invoice must block the write');
  assert(msg.includes('PS-INV116968'), `it has to name what is there: ${msg}`);
  assert(invoiceCellBlocked('S-ORD115612', 'PS-INV117078'), 'a sales-order lot counts too');
});

test('REWRITING A CELL WITH THE SAME NUMBER IS NOT A CONFLICT', () => {
  // Re-running a correction must be free, the same way recording an invoice
  // twice corrects rather than claiming the credit twice.
  equal(invoiceCellBlocked('PS-INV117078', 'PS-INV117078'), '', 'identical is fine');
  equal(invoiceCellBlocked('ps inv 117078', 'PS-INV117078'), '', 'and so is the same number spelled differently');
});

test('A ROW STILL WAITING IS WRITABLE EVEN THOUGH IT NAMES AN INVOICE', () => {
  // "NEEDS INVOICE (lot name says PS-INV117057)" is a HINT about where the row
  // came from, not a record of which invoice paid for it.
  equal(invoiceCellBlocked('NEEDS INVOICE (lot name says PS-INV117057)', 'PS-INV117078'), '',
    'a waiting row is exactly what this is for');
});

suite('correcting what an appliance IS');

test('A MODEL TYPO IS WHAT MAKES THE NEXT INVOICE ADD IT TWICE', () => {
  // The reason a model correction needs a path at all. `modelsMatch` is what
  // pairs a supplier's line to a row already on the tracker; two rows of the
  // Bertazzoni lot carried models that do not exist, so nothing could match
  // them and a later invoice would have booked the same range in again.
  assert(!modelsMatch('F8PGR366S2', 'F6PDF366S1'), 'a wrong model matches nothing');
  assert(!modelsMatch('F6PDF366S2', 'F6PDF366S1'), 'S1 and S2 are different ranges, not a revision suffix');
  assert(!modelsMatch('MRU217BST', 'MRU21C7BST'), 'the PS-INV117057 typo the same way');
  // And once corrected they pair, which is the whole point of fixing them.
  assert(modelsMatch('F6PDF366S1', 'F6PDF366S1'), 'the corrected model matches its own invoice line');
  assert(modelsMatch('F6PGR366S2', 'f6pgr-366 s2'), 'case and punctuation still do not matter');
});

suite('a haul-away has no invoice to wait for');

test('IT IS NOT WAITING, SO IT LEAVES THE STOCK GAPS LIST', () => {
  // The whole point. 10 haul-aways booked in on 2026-09-30 landed as NEEDS
  // INVOICE and would have sat on the daily email for ever, because the
  // paperwork they were waiting for does not exist.
  assert(isHaulAway('HAUL-AWAY'), 'the marker reads as a haul-away');
  assert(!isWaitingForInvoice('HAUL-AWAY'), 'and never as a row awaiting an invoice');
  assert(!isWaitingForInvoice('HAUL-AWAY — kerbside pickup'), 'a note after it changes nothing');
});

test('IT CAN NEVER BE CLAIMED BY SOMEBODY ELSE’S INVOICE', () => {
  // `fillWaitingRows` only writes a row that is still waiting, and
  // `unitsOnInvoice` only counts a row whose cell names the invoice. A
  // haul-away must fail both, or a supplier's invoice could absorb a machine
  // nobody bought and the reconciliation would silently pass.
  assert(!sameInvoiceNumber('HAUL-AWAY', 'PS-INV117385'), 'it matches no invoice number');
  assert(!sameInvoiceNumber('HAUL-AWAY', 'S-ORD115828'), 'nor a sales-order lot');
  // And it is not waiting, so `fillWaitingRows` refuses it outright — that is
  // the guard that actually stops an invoice absorbing it, not the name test.
  assert(!isWaitingForInvoice('HAUL-AWAY'), 'fillWaitingRows will not touch it');
});

test('THE LOT NAME IS READ THE WAY A VENDOR NAME IS FOLDED', () => {
  assert(isHaulAwayLot('SS-Haulaways'), 'the real lot');
  assert(isHaulAwayLot('haul away'), 'spaced');
  assert(isHaulAwayLot('HAUL-AWAYS'), 'hyphenated and plural');
  assert(!isHaulAwayLot('PS-INV117385'), 'an ordinary purchase lot is not one');
  assert(!isHaulAwayLot('SS-117082'), 'nor is a hand-booked lot');
});

test('THE MARKER IS REPLACEABLE IF A UNIT TURNS OUT TO BE BOUGHT', () => {
  // Not an invoice-like code, so correcting it needs no `force` — same as a
  // note or a filename.
  equal(invoiceCellBlocked('HAUL-AWAY', 'PS-INV117385'), '', 'it can be corrected to a real invoice');
});

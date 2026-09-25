// The SALE predicate, and the fact that there are nine of it.
//
// "What counts as a sale" decides the Revenue KPI, the P&L, the books, the
// ledger, the HST remittance, the customer list, the marketing audience and
// driver pay. CLAUDE.md says the duplication is deliberate — each surface would
// be worse if it silently disagreed with the others — and that the rule is
// "change one, change all".
//
// NOTHING ENFORCED THAT. It was a sentence in a document, and a sentence cannot
// fail a build. This reads the definitions out of the source and compares them,
// so a copy that drifts is a red test rather than two dashboards quietly
// disagreeing about the month.
//
// Reading source text in a test is unusual and is the point here: the thing
// under test IS that nine hand-copied fragments still match.
import { readFileSync } from 'node:fs';
import { suite, test, assert, equal } from './_harness.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// The accrual predicate: settled orders PLUS a pending_payment order backed by
// an open/partial invoice, so a deposit counts on the day of sale.
const ACCRUAL_FILES = ['lib/analytics.js', 'lib/pnl.js', 'lib/books.js', 'lib/ledger.js'];

// The plain status list, used where the invoice bridge is not wanted.
const STATUS_LIST_FILES = ['lib/campaigns.js', 'lib/customers.js', 'lib/payroll.js', 'lib/finance-report.js'];

const STATUSES = "'confirmed','ready','out_for_delivery','delivered'";

function accrualBody(file) {
  const src = read(file);
  const m = src.match(/const SALE = \(t = '[^']+'\) => `([\s\S]*?)`;/);
  assert(m, `${file}: no accrual SALE definition found — has it been renamed?`);
  // Normalise the table alias so `orders.` and `o.` compare equal; that is the
  // one thing these copies are ALLOWED to differ by.
  return m[1].replace(/\$\{t\}/g, 'T').replace(/\s+/g, ' ').trim();
}

function statusListBody(file) {
  const src = read(file);
  const m = src.match(/const SALE = "(\([^"]*\))";/);
  assert(m, `${file}: no status-list SALE definition found`);
  return m[1].replace(/\s+/g, ' ').trim();
}

suite('SALE — the four accrual copies must be identical');

test('all four are character-identical once the alias is normalised', () => {
  const bodies = ACCRUAL_FILES.map((f) => [f, accrualBody(f)]);
  const [firstFile, first] = bodies[0];
  for (const [file, body] of bodies.slice(1)) {
    equal(body, first, `${file} has drifted from ${firstFile}`);
  }
});

test('and each one actually contains the invoice bridge', () => {
  // The bridge is what makes a deposit count on the day of sale. A copy that
  // lost it would silently move revenue to the day the balance landed.
  for (const file of ACCRUAL_FILES) {
    const body = accrualBody(file);
    assert(body.includes("T.status = 'pending_payment'"), `${file}: lost the pending_payment arm`);
    assert(body.includes('FROM invoices bi'), `${file}: lost the invoice bridge`);
    assert(body.includes("bi.status IN ('open','partial')"), `${file}: lost the open/partial test`);
    assert(body.includes(STATUSES), `${file}: settled-status list changed`);
  }
});

test('lib/ledger.js is one of them — CLAUDE.md lists only three', () => {
  // The doc says analytics, pnl and books. ledger.js has a fourth identical
  // copy and is named nowhere. Pinned so the count in the docs is checkable.
  equal(ACCRUAL_FILES.length, 4, 'four files carry the accrual predicate');
  assert(ACCRUAL_FILES.includes('lib/ledger.js'));
});

suite('SALE — the status-list copies');

test('every status-list copy is the same list', () => {
  for (const file of STATUS_LIST_FILES) {
    equal(statusListBody(file), `(${STATUSES})`, `${file} has a different status list`);
  }
});

test('the status list agrees with the settled arm of the accrual predicate', () => {
  // These are two shapes of the same business rule. If somebody adds a status
  // to one, the other has to learn about it — otherwise the dashboard and the
  // customer list start counting different orders.
  const accrual = accrualBody('lib/analytics.js');
  for (const file of STATUS_LIST_FILES) {
    const list = statusListBody(file).replace(/^\(|\)$/g, '');
    assert(accrual.includes(list),
      `${file}'s status list is not the one inside the accrual predicate`);
  }
});

test('lib/finance-report.js is cash-basis ON PURPOSE and keeps its own', () => {
  // Documented: the books report money COLLECTED, so this one must NOT grow the
  // invoice bridge. It shares the status list and nothing else.
  const src = read('lib/finance-report.js');
  assert(!/const SALE = \(t/.test(src),
    'finance-report has grown an accrual SALE — it is deliberately cash-basis');
});

suite('SALE — the consent lookup uses the same rule');

test('implied consent counts the same orders a sale does', () => {
  // lib/consent decides who may be marketed to from "bought in the last 24
  // months". If its idea of a purchase drifted from everything else's, the
  // marketing list would quietly include or exclude the wrong people.
  const src = read('lib/consent.js');
  assert(src.includes(STATUSES),
    'lib/consent.js no longer uses the same settled-status list');
});

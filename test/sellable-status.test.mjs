// What the storefront publishes off the master tracker.
//
// The rule is a PREFIX, not a list (owner, 2026-09-28): any Status the tracker
// spells as "Tested Working" sells, whatever follows it. It was a fixed list of
// three, and the day somebody typed "Tested Working - Refurbished" the unit fell
// off the site in silence — counted as not-tested, with nothing anywhere saying
// why.
//
// This test exists because the failure mode is invisible. A status that stops
// publishing produces no error and no warning: the unit is simply absent.
import { suite, test, assert, equal } from './_harness.mjs';
import { parseTrackerCsv, isSellableStatus } from '../lib/csv.js';

suite('sellable tracker statuses');

// Every distinct Status on the tracker's Main tab, read live 2026-09-28, with
// what each one must do. If a real status is ever added, add it here too — this
// list is the point.
const LIVE_TRACKER_STATUSES = [
  ['Tested Working', true],
  ['Tested Working - Needs Cleaning', true],
  ['Tested Working - Needs QA', true],
  ['Tested Working - Refurbished', true],
  ['Sold', false],
  ['Untested', false],
  ['Tested Not Working - Needs Diagnosis', false],
  ['Tested Not Working - Needs Parts', false],
  ['Tested not working - needs parts', false],
  ['Tested Not Working - Parts Ordered', false],
  ['Salvage For Parts Only', false]
];

test('every status on the live tracker sells, or does not, as intended', () => {
  for (const [status, sells] of LIVE_TRACKER_STATUSES) {
    equal(isSellableStatus(status), sells, `"${status}"`);
  }
});

test('a Tested Working variant nobody has thought of yet still sells', () => {
  for (const s of ['Tested Working - Refurbished', 'Tested Working — Needs Parts Fitted', 'Tested Working (ready)', 'tested  working - NEEDS qa']) {
    assert(isSellableStatus(s), `"${s}" should sell`);
  }
});

// The prefix is only safe because "Tested NOT Working" does not start with
// "Tested Working". If that ever stops being true the whole rule is wrong.
test('the not-working family is excluded by the same test', () => {
  for (const s of ['Tested Not Working', 'Tested Not Working - Needs Parts', 'TESTED NOT WORKING - PARTS ORDERED']) {
    assert(!isSellableStatus(s), `"${s}" must never sell`);
  }
});

test('a word that merely begins with the status does not count', () => {
  assert(!isSellableStatus('Tested Workingish'), 'Tested Workingish');
  assert(!isSellableStatus('Tested Workings'), 'Tested Workings');
});

const HEADER = 'Item ID / SKU,Make,Model,Retail Price,Condition,Condition %,Suggested Sale Price,Status,Total Cost';
// Priced by default; `{ priced: false }` is an ungraded row — no Condition %,
// no retail and no Suggested cell, which is what the tracker actually looks like
// before somebody grades the machine.
const row = (sku, status, { priced = true } = {}) =>
  `${sku},Frigidaire,FFHN2750TS,${priced ? '$1889.00' : ''},Refurbished,${priced ? '50.0%' : ''},${priced ? '$944.50' : ''},${status},$358.35`;

test('parseTrackerCsv imports every Tested Working variant', () => {
  const { units, report } = parseTrackerCsv([
    HEADER,
    row('A-1', 'Tested Working'),
    row('A-2', 'Tested Working - Needs Cleaning'),
    row('A-3', 'Tested Working - Refurbished'),
    row('A-4', 'Sold'),
    row('A-5', 'Tested Not Working - Needs Parts')
  ].join('\n'));
  equal(units.map((u) => u.id), ['A-1', 'A-2', 'A-3'], 'imported SKUs');
  equal(report.skippedNotTested, 2, 'skippedNotTested');
});

// The real gate on publishing is the PRICE, not the status string — an ungraded
// row has no Condition %, so no price, and cannot reach the site whatever it
// says in the Status column.
test('a Tested Working row with no price is still refused', () => {
  const { units, report } = parseTrackerCsv([
    HEADER,
    row('B-1', 'Tested Working - Refurbished', { priced: false })
  ].join('\n'));
  equal(units.length, 0, 'nothing imported');
  equal(report.skippedNoPrice, 1, 'counted as a finished row with no price');
});

// skippedNoPrice is the warning that caught the 61-unit outage; it must only
// ever count rows the shop considers FINISHED, or it becomes noise.
test('an ungraded row in cleaning or QA is not reported as the alarm', () => {
  const { report } = parseTrackerCsv([
    HEADER,
    row('C-1', 'Tested Working - Needs Cleaning', { priced: false }),
    row('C-2', 'Tested Working - Needs QA', { priced: false })
  ].join('\n'));
  equal(report.skippedNoPrice, 0, 'skippedNoPrice');
  equal(report.skippedUngraded, 2, 'skippedUngraded');
});

// Callers that ask for one status mean that one exactly — readByStatus lists the
// intake queue ('Untested') and the salvage pile, and must not inherit the
// storefront's prefix rule.
test('an explicit opts.status is still matched exactly', () => {
  const csv = [
    HEADER,
    row('D-1', 'Untested'),
    row('D-2', 'Tested Working'),
    row('D-3', 'Salvage For Parts Only')
  ].join('\n');
  equal(parseTrackerCsv(csv, { status: 'untested', requirePrice: false }).units.map((u) => u.id), ['D-1'], 'untested only');
  equal(parseTrackerCsv(csv, { status: 'salvage for parts only', requirePrice: false }).units.map((u) => u.id), ['D-3'], 'salvage only');
});

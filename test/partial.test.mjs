// lib/partial.js — reads that may fail, but may not fail quietly.
//
// The property under test is narrow and it is the whole point: when a query
// falls over, the caller must be able to tell that apart from "there were no
// rows". The financial pages could not, and a trial balance built from balanced
// pairs still balanced with a whole section missing.
import { suite, test, assert, equal } from './_harness.mjs';
import { reader, partialWarning, isTimeout } from '../lib/partial.js';

suite('lib/partial — a failed read is not an empty one');

// With no POSTGRES_URL, lib/db throws on every query. That is precisely the
// failure path this module exists to handle, so it needs no fake database.
const noDb = () => { delete process.env.POSTGRES_URL; };
// And no DSN, so captureError is a no-op and nothing is posted anywhere.
delete process.env.SENTRY_DSN;

test('a failing read returns [] — the page still renders', async () => {
  noDb();
  const read = reader('test');
  const rows = await read('invoices raised', 'SELECT 1');
  equal(rows, [], 'rows should be an empty array, not a throw');
});

test('...but records the failure, with the section name', async () => {
  noDb();
  const read = reader('test');
  await read('invoices raised', 'SELECT 1');
  equal(read.incomplete, true, 'should be flagged incomplete');
  equal(read.problems.length, 1, 'one problem recorded');
  equal(read.problems[0].label, 'invoices raised', 'problem names its section');
  assert(read.problems[0].message, 'problem carries the underlying message');
});

test('a reader that succeeds is NOT flagged incomplete', () => {
  const read = reader('test');
  equal(read.incomplete, false, 'nothing read, nothing failed');
  equal(read.problems, [], 'no problems');
});

test('failures accumulate per section, in order', async () => {
  noDb();
  const read = reader('test');
  await read('sales', 'SELECT 1');
  await read('payments', 'SELECT 1');
  equal(read.problems.map((p) => p.label), ['sales', 'payments'], 'both sections, in order');
});

test('a statement timeout is told apart from any other failure', () => {
  // The strings Postgres actually sends, rather than a database made to be slow.
  assert(isTimeout('canceling statement due to statement timeout'), 'the standard message');
  assert(isTimeout('ERROR: canceling statement due to user request'), 'cancellation');
  assert(isTimeout('query_canceled'), 'the condition name');
  assert(isTimeout('57014'), 'the SQLSTATE');

  assert(!isTimeout('relation "invoices" does not exist'), 'a missing table is NOT a timeout');
  assert(!isTimeout('permission denied for table orders'), 'a permissions error is NOT a timeout');
  assert(!isTimeout(''), 'empty');
  assert(!isTimeout(null), 'null');
});

suite('lib/partial — the warning line');

test('no problems means no warning at all', () => {
  equal(partialWarning([]), null, 'empty');
  equal(partialWarning(null), null, 'null');
  equal(partialWarning(undefined), null, 'undefined');
});

test('one problem reads as one section', () => {
  const w = partialWarning([{ label: 'refunds', message: 'boom', timedOut: false }]);
  equal(w.sections, ['refunds'], 'section carried');
  assert(/One section/.test(w.text), 'singular phrasing');
  assert(/INCOMPLETE/.test(w.text), 'says incomplete');
  assert(!/timed out/.test(w.text), 'no timeout advice when it did not time out');
});

test('several problems are all named', () => {
  const w = partialWarning([
    { label: 'sales', message: 'x', timedOut: false },
    { label: 'refunds', message: 'y', timedOut: true }
  ]);
  equal(w.sections, ['sales', 'refunds'], 'both named');
  assert(/2 sections/.test(w.text), 'plural phrasing with a count');
  equal(w.timedOut, true, 'timeout flagged if ANY section timed out');
  assert(/shorter period/.test(w.text), 'offers the actionable advice');
});

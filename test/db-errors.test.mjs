// A missing table is a migration nobody ran, not a server fault.
//
// Written after the supplier panel was opened on production the day its PR
// merged and answered `relation "suppliers" does not exist` in a red box. The
// code was correct and deployed; the migration had not been run, and nothing
// anywhere said that was a button somebody has to press.
import { suite, test, assert, equal } from './_harness.mjs';
import { explainDbError } from '../lib/migrate.js';

suite('explainDbError — a missing table names the button, not the SQL');

test('the raw Postgres message is replaced, and the table is named', () => {
  const e = Object.assign(new Error('relation "suppliers" does not exist'), { code: '42P01' });
  const msg = explainDbError(e);
  assert(/Run schema migration/i.test(msg), 'it names the button');
  assert(msg.includes('suppliers'), 'and which table is missing');
  assert(!/^relation/.test(msg), 'and does not lead with the SQL');
});

test('it works off the MESSAGE too, not only the code', () => {
  // The code is not always populated through every driver path.
  const msg = explainDbError(new Error('relation "part_moves" does not exist'));
  assert(/Run schema migration/i.test(msg));
  assert(msg.includes('part_moves'));
});

test('IT SAYS A DEPLOY IS NOT A MIGRATION — that is the whole misunderstanding', () => {
  const e = Object.assign(new Error('relation "suppliers" does not exist'), { code: '42P01' });
  assert(/deploy/i.test(explainDbError(e)), 'the message explains why a merged PR is not enough');
});

test('every OTHER error is passed through untouched', () => {
  equal(explainDbError(new Error('What is the supplier called?')), 'What is the supplier called?');
  equal(explainDbError(Object.assign(new Error('duplicate key'), { code: '23505' })), 'duplicate key');
});

test('it never returns undefined', () => {
  equal(explainDbError(null), 'Something went wrong.');
  equal(explainDbError({}), 'Something went wrong.');
});

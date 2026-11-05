// Naming e-transfers from Interac's confirmation emails. The bank feed carries no
// recipient; the email does. The rule that matters is that it NEVER GUESSES.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { parseInteracSent, looksLikeSentTransfer, matchTransfers, nameTransfersFromEmail } from '../lib/interac-names.js';
import { upsertExpense, annotateExpenses } from '../lib/finance.js';

const day = (d) => Date.parse(`${d}T15:00:00Z`);
const mail = (id, amount, name, d) => ({ id, subject: `Interac e-Transfer: Your $${amount} transfer to ${name} has been successfully deposited.`, internalDate: day(d) });
const bank = (id, amount, date, desc = 'SEND E-TFR *abc SUPP') => upsertExpense({
  incurredOn: date, category: 'Other', vendor: desc, amount, tax: null, note: 'TD', extId: `plaid:${id}`, source: 'plaid',
  catSource: 'guess', bankDesc: desc
});
const idOf = async (id) => (await query('SELECT id FROM expenses WHERE ext_id = $1', [`plaid:${id}`])).rows[0].id;
const row = async (id) => (await query('SELECT * FROM expenses WHERE ext_id = $1', [`plaid:${id}`])).rows[0];

suite('reading Interac\'s email');

test('THE AMOUNT AND THE RECIPIENT COME OUT OF THE SUBJECT, COMMAS AND ALL', () => {
  const a = parseInteracSent({ subject: 'Interac e-Transfer: Your $1,356.00 transfer to OURR HOME & APPLIANCES has been successfully deposited.', internalDate: day('2026-10-07') });
  equal(a.amountCents, 135600); equal(a.name, 'OURR HOME & APPLIANCES'); equal(a.at, day('2026-10-07'));
  equal(parseInteracSent({ subject: 'Interac e-Transfer: You\'ve received $750.00 from Jermaine Rattray and it has been automatically deposited.' }), null, 'money IN is not an e-transfer we sent');
  equal(parseInteracSent({ subject: 'Your statement is ready' }), null);
  equal(parseInteracSent({ subject: 'Your $50 transfer to  A   B  has been successfully deposited', date: 'Tue, 06 Oct 2026 10:00:00 -0400' }).name, 'A B', 'whitespace tidied');
});

test('ONLY A SENT E-TRANSFER LINE CAN BE NAMED THIS WAY', () => {
  assert(looksLikeSentTransfer('SEND E-TFR *nMU EXP'));
  assert(looksLikeSentTransfer('E-TRANSFER SENT'));
  assert(!looksLikeSentTransfer('HOME DEPOT #7045'));
});

suite('matching never guesses');

test('A UNIQUE AMOUNT IN THE DATE WINDOW IS NAMED; THE SAME AMOUNT TWICE IS LEFT FOR A PERSON', () => {
  const emails = [
    { id: 'e1', amountCents: 135600, name: 'OURR HOME', at: day('2026-10-07') },
    { id: 'e2', amountCents: 50000, name: 'REZA', at: day('2026-10-27') },
    { id: 'e3', amountCents: 50000, name: 'NICHOLAS', at: day('2026-10-28') }
  ];
  const lines = [
    { id: 1, grossCents: 135600, date: '2026-10-06' },
    { id: 2, grossCents: 50000, date: '2026-10-26' },       // two $500 emails fit it
    { id: 3, grossCents: 99999, date: '2026-10-26' }         // no email at all
  ];
  const m = matchTransfers(emails, lines);
  equal(m.length, 1); equal(m[0].lineId, 1); equal(m[0].name, 'OURR HOME');
});

test('TWO LINES FOR ONE EMAIL ARE BOTH LEFT ALONE', () => {
  const emails = [{ id: 'e1', amountCents: 20000, name: 'RAVINDER', at: day('2026-10-10') }];
  const lines = [{ id: 1, grossCents: 20000, date: '2026-10-09' }, { id: 2, grossCents: 20000, date: '2026-10-10' }];
  equal(matchTransfers(emails, lines).length, 0);
});

test('THE EMAIL MUST COME ON OR JUST AFTER THE DEBIT, NOT WEEKS AWAY', () => {
  const emails = [{ id: 'e1', amountCents: 20000, name: 'RAVINDER', at: day('2026-10-10') }];
  equal(matchTransfers(emails, [{ id: 1, grossCents: 20000, date: '2026-10-09' }]).length, 1, 'a day before the email');
  equal(matchTransfers(emails, [{ id: 1, grossCents: 20000, date: '2026-10-11' }]).length, 1, 'a timezone-sized slip');
  equal(matchTransfers(emails, [{ id: 1, grossCents: 20000, date: '2026-10-25' }]).length, 0, 'debited after the email is somebody else');
  equal(matchTransfers(emails, [{ id: 1, grossCents: 20000, date: '2026-09-01' }]).length, 0, 'weeks earlier is somebody else');
});

suite('naming the ledger');

test('LINES ARE NAMED FROM THE EMAILS, A TYPED NAME IS NEVER OVERWRITTEN, AND RE-RUNNING CHANGES NOTHING', async () => {
  const { done } = await withTestDb();
  try {
    await bank('t1', 1356, '2026-10-06');
    await bank('t2', 500, '2026-10-26');
    await bank('t3', 77, '2026-10-20');
    await bank('h', 40, '2026-10-20', 'HOME DEPOT #7045');
    await annotateExpenses({ ids: [await idOf('t3')], payee: 'Typed By Hand' });
    const emailsFn = async () => [
      mail('m1', '1,356.00', 'OURR HOME & APPLIANCES', '2026-10-07'),
      mail('m2', '500.00', 'REZA QUMRUZZAMAN UDDIN', '2026-10-27'),
      mail('m3', '77.00', 'SOMEONE ELSE', '2026-10-21')
    ];
    const r = await nameTransfersFromEmail({ emailsFn });
    equal(r.ok, true); equal(r.named.length, 2);
    equal((await row('t1')).payee_override, 'OURR HOME & APPLIANCES');
    equal((await row('t1')).vendor, 'OURR HOME & APPLIANCES');
    assert(/Interac/.test((await row('t1')).user_note), 'says where the name came from');
    equal((await row('t2')).payee_override, 'REZA QUMRUZZAMAN UDDIN');
    equal((await row('t3')).payee_override, 'Typed By Hand', 'a name a person typed wins');
    equal((await row('h')).payee_override, null, 'a card purchase is not an e-transfer');
    const again = await nameTransfersFromEmail({ emailsFn });
    equal(again.named.length, 0, 'nothing left to do');
  } finally { done(); }
});

test('A DRY RUN SAYS WHAT IT WOULD DO AND WRITES NOTHING', async () => {
  const { done } = await withTestDb();
  try {
    await bank('t1', 1356, '2026-10-06');
    const r = await nameTransfersFromEmail({ dryRun: true, emailsFn: async () => [mail('m1', '1,356.00', 'OURR HOME', '2026-10-07')] });
    equal(r.named.length, 1); equal(r.named[0].dryRun, true);
    equal((await row('t1')).payee_override, null);
  } finally { done(); }
});

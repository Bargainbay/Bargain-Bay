// Who is owed what and what has been paid; the live transaction list; a till count for yesterday.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertExpense } from '../lib/finance.js';
import { addOwed, addPayment, voidPayLine, payBalances, payCandidates, linkWaitingPayments, balanceOf } from '../lib/pay-ledger.js';
import { addEntry, bankrollSummary } from '../lib/bankroll.js';

const tick = () => new Promise((r) => setTimeout(r, 25));
const bankLine = (extId, amount, date = '2026-11-08', vendor = 'SEND E-TFR') =>
  upsertExpense({ incurredOn: date, category: 'Other', vendor, amount, tax: null, note: 'TD', extId, source: 'plaid' });
const exp = async (src) => (await query('SELECT * FROM expenses WHERE source = $1 ORDER BY id', [src])).rows;

suite('pay ledger');

test('balanceOf: OWED MINUS PAID', () => {
  const b = balanceOf([{ kind: 'owed', amount: 500 }, { kind: 'paid', amount: 420 }]);
  equal(b.owed, 500); equal(b.paid, 420); equal(b.balance, 80);
});

test('ROUSHI: OWED $500 FOR THE WEEK, PAID $420 CASH FROM THE TILL, $80 STILL OWED, AND THE TILL IS DOWN $420', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-07', kind: 'count', amount: 1970, by: 'a' }); await tick();
    await addOwed({ person: 'Roushi', periodStart: '2026-10-19', periodEnd: '2026-10-25', amount: 500, by: 'a' });
    await addPayment({ person: 'Roushi', amount: 420, date: '2026-11-08', how: 'cash', periodStart: '2026-10-19', periodEnd: '2026-10-25', by: 'a' });
    const w = (await exp('cash'));
    equal(w.length, 1); equal(w[0].category, 'Wages'); equal(Number(w[0].tax), 0); assert(w[0].reviewed_at);
    const p = (await payBalances()).people.find((x) => x.person === 'Roushi');
    equal(p.balance, 80);
    equal((await bankrollSummary('2026-11-08')).cash, 1550, 'the till is down by what was handed over');
  } finally { done(); }
});

test('A TILL COUNT FOR YESTERDAY IS THE CLOSING FIGURE: TODAY\'S MOVEMENTS ARE ADDED TO IT', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-07', kind: 'count', amount: 1970, by: 'a' }); await tick();
    await addEntry({ date: '2026-11-08', kind: 'cash', amount: -1550, note: 'Paid Abi', by: 'a' });
    const s = await bankrollSummary('2026-11-08');
    equal(s.cash, 420);
    assert(s.live.some((l) => l.tag === 'Cash' && l.amount === -1550), 'it shows in the live list');
  } finally { done(); }
});

test('A BANK PAYMENT MARKS THE E-TRANSFER AS WAGES WITH NO HST AND NAMES THE PERSON, WITHOUT A SECOND COST', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine('plaid:w1', 300);
    const c = await payCandidates({ amount: 300, date: '2026-11-08' });
    equal(c.length, 1);
    await addPayment({ person: 'Ravi', amount: 300, date: '2026-11-08', how: 'bank', expenseId: c[0].id, by: 'a' });
    const l = (await exp('plaid'))[0];
    equal(l.category, 'Wages'); equal(l.payee_override, 'Ravi'); equal(Number(l.amount), 300); equal(Number(l.tax), 0);
    equal((await exp('cash')).length, 0, 'no extra expense for a bank payment');
    equal((await payCandidates({ amount: 300, date: '2026-11-08' })).length, 0, 'that line is taken');
    let msg = ''; try { await addPayment({ person: 'X', amount: 300, date: '2026-11-08', how: 'bank', expenseId: l.id, by: 'a' }); } catch (e) { msg = e.message; }
    assert(/already used/.test(msg));
  } finally { done(); }
});

test('A BANK PAYMENT RECORDED BEFORE THE BANK SHOWS IT LINKS ITSELF LATER', async () => {
  const { done } = await withTestDb();
  try {
    await addPayment({ person: 'Ravi', amount: 150, date: '2026-11-08', how: 'bank', by: 'a' });
    equal((await payBalances()).people[0].lines[0].waitingForBank, true);
    await bankLine('plaid:w2', 150);
    equal(await linkWaitingPayments(), 1);
    equal((await exp('plaid'))[0].category, 'Wages');
    equal((await payBalances()).people[0].lines[0].waitingForBank, false);
  } finally { done(); }
});

test('VOIDING A CASH PAYMENT TAKES ITS EXPENSE OUT AND PUTS THE CASH BACK', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-07', kind: 'count', amount: 500, by: 'a' }); await tick();
    const r = await addPayment({ person: 'Roushi', amount: 100, date: '2026-11-08', how: 'cash', by: 'a' });
    equal((await bankrollSummary('2026-11-08')).cash, 400);
    await voidPayLine(r.id, 'a');
    equal((await exp('cash')).length, 0); equal((await bankrollSummary('2026-11-08')).cash, 500);
  } finally { done(); }
});

test('THE LIVE LIST HAS EVERY KIND OF MOVEMENT, AND MARKS BANK LINES ALREADY IN PAYROLL', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine('plaid:l1', 80, '2026-11-08', 'HOME DEPOT');
    await bankLine('plaid:l2', 200, '2026-11-08', 'SEND E-TFR');
    const line = (await exp('plaid')).find((r) => Number(r.amount) === 200);
    await addPayment({ person: 'Ravi', amount: 200, date: '2026-11-08', how: 'bank', expenseId: line.id, by: 'a' });
    await query(`INSERT INTO invoice_payments (invoice_id, amount, method, paid_at) VALUES (1, 90, 'cash', now())`);
    const s = await bankrollSummary('2026-11-08', { days: 7 });
    const tags = new Set(s.live.map((l) => l.tag));
    assert(tags.has('Bank out') && tags.has('Cash sale'), 'bank and cash sales together: ' + [...tags]);
    assert(s.live.find((l) => l.expenseId === line.id).inPayroll === true);
    assert(s.live.find((l) => l.expenseId !== line.id && l.tag === 'Bank out').inPayroll === false);
  } finally { done(); }
});

test('OWED NEEDS A PERSON, A PERIOD AND AN AMOUNT', async () => {
  const { done } = await withTestDb();
  try {
    const bad = async (o) => { try { await addOwed({ person: 'R', periodStart: '2026-10-19', periodEnd: '2026-10-25', amount: 5, ...o }); return ''; } catch (e) { return e.message; } };
    assert(/who/i.test(await bad({ person: '' })));
    assert(/amount/i.test(await bad({ amount: 0 })));
    assert(/period/i.test(await bad({ periodStart: '' })));
    assert(/ends before/i.test(await bad({ periodEnd: '2026-10-01' })));
  } finally { done(); }
});

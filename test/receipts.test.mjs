// Receipts: cash, card/bank and out-of-pocket each book the cost exactly once.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertExpense, listUnreviewedExpenses } from '../lib/finance.js';
import { createReceipt, listReceipts, bankCandidates, markReimbursed, voidReceipt, linkWaitingReceipts, splitReceipt } from '../lib/receipts.js';
import { cleanRead } from '../lib/receipt-read.js';
import { addEntry, bankrollSummary } from '../lib/bankroll.js';

const bankLine = (extId, amount, date = '2026-11-05', vendor = 'HOME DEPOT') =>
  upsertExpense({ incurredOn: date, category: 'Other', vendor, amount, tax: null, note: 'TD', extId, source: 'plaid' });
const tick = () => new Promise((r) => setTimeout(r, 25)); // timestamps are compared in the database, so let the clock move
const expensesOf = async (src) => (await query('SELECT * FROM expenses WHERE source = $1 ORDER BY id', [src])).rows;

suite('receipts');

test('splitReceipt: TAX IS INSIDE THE TOTAL; UNKNOWN TAX STAYS UNKNOWN', () => {
  const a = splitReceipt(113, 13); equal(a.amount, 100); equal(a.tax, 13);
  const b = splitReceipt(50, null); equal(b.amount, 50); assert(b.tax === null);
});

test('A CASH RECEIPT BOOKS THE COST ONCE, IS ALREADY REVIEWED, AND LOWERS THE CASH', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-06', kind: 'count', amount: 500, by: 'a' }); await tick();
    const id = await createReceipt({ date: '2026-11-06', vendor: 'Canadian Tire', total: 113, tax: 13, category: 'Tools / supplies', paidWith: 'cash', by: 'a' });
    const ex = await expensesOf('cash');
    equal(ex.length, 1); equal(Number(ex[0].amount), 100); equal(Number(ex[0].tax), 13); assert(ex[0].reviewed_at, 'typed by a person, so reviewed');
    equal((await listUnreviewedExpenses()).length, 0, 'not in the bank review queue');
    equal((await bankrollSummary('2026-11-06')).cash, 387);
    await voidReceipt(id, 'a');
    equal((await expensesOf('cash')).length, 0, 'voiding takes the cost out');
    equal((await bankrollSummary('2026-11-06')).cash, 500, 'and puts the cash back');
  } finally { done(); }
});

test('A CARD RECEIPT CREATES NO EXPENSE: IT LINKS TO THE BANK LINE AND HANDS IT THE CATEGORY AND HST', async () => {
  const { done } = await withTestDb();
  try {
    const id = await createReceipt({ date: '2026-11-05', vendor: 'Home Depot', total: 226, tax: 26, category: 'Tools / supplies', paidWith: 'bank', by: 'a' });
    equal((await expensesOf('cash')).length + (await expensesOf('personal')).length, 0, 'no second cost');
    equal((await listReceipts())[0].bank.state, 'waiting');
    await bankLine('plaid:h1', 226);
    equal(await linkWaitingReceipts(), 1, 'links itself once the bank shows it');
    const [l] = await expensesOf('plaid');
    equal(l.category, 'Tools / supplies'); equal(Number(l.amount), 200); equal(Number(l.tax), 26); equal(l.cat_source, 'manual');
    equal((await listReceipts())[0].bank.state, 'linked');
    void id;
  } finally { done(); }
});

test('TWO BANK LINES OF THE SAME AMOUNT ARE NEVER GUESSED BETWEEN', async () => {
  const { done } = await withTestDb();
  try {
    const id = await createReceipt({ date: '2026-11-05', vendor: 'Esso', total: 60, category: 'Fuel / delivery', paidWith: 'bank', by: 'a' });
    await bankLine('plaid:e1', 60, '2026-11-05', 'ESSO'); await bankLine('plaid:e2', 60, '2026-11-06', 'ESSO');
    equal(await linkWaitingReceipts(), 0);
    equal((await bankCandidates(id)).length, 2, 'a person picks');
    equal((await listReceipts())[0].bank.state, 'waiting');
  } finally { done(); }
});

test('OUT OF POCKET: A COST NOW, OWED BACK, AND PAYING BACK BY BANK TAKES THE E-TRANSFER OUT SO IT IS NOT A SECOND COST', async () => {
  const { done } = await withTestDb();
  try {
    const id = await createReceipt({ date: '2026-11-04', vendor: 'Staples', total: 80, tax: null, category: 'Other', paidWith: 'personal', paidBy: 'Ravi', by: 'a' });
    equal((await expensesOf('personal')).length, 1);
    let r = (await listReceipts())[0]; equal(r.reimburse, 'owed');
    equal((await bankrollSummary('2026-11-06')).owed.amount, 80);
    await bankLine('plaid:r1', 80, '2026-11-06', 'SEND E-TFR RAVI');
    const cand = await bankCandidates(id, { afterOnly: true, daysAfter: 120 });
    equal(cand.length, 1);
    await markReimbursed(id, { how: 'bank', on: '2026-11-06', bankExpenseId: cand[0].id, by: 'a' });
    equal((await expensesOf('plaid')).length, 0, 'the e-transfer is not counted as a cost');
    equal((await expensesOf('personal')).length, 1, 'the receipt cost stays');
    r = (await listReceipts())[0]; equal(r.reimburse, 'reimbursed');
    let msg = ''; try { await markReimbursed(id, { how: 'other', by: 'a' }); } catch (e) { msg = e.message; }
    assert(/not waiting/.test(msg), 'cannot be paid back twice');
    let m2 = ''; try { await voidReceipt(id, 'a'); } catch (e) { m2 = e.message; }
    assert(/cannot be voided/.test(m2), 'a bank repayment cannot be silently voided');
  } finally { done(); }
});

test('PAYING BACK IN CASH TAKES IT OUT OF THE TILL', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-06', kind: 'count', amount: 300, by: 'a' }); await tick();
    const id = await createReceipt({ date: '2026-11-06', vendor: 'Staples', total: 80, category: 'Other', paidWith: 'personal', paidBy: 'Ravi', by: 'a' });
    equal((await bankrollSummary('2026-11-06')).cash, 300, 'a personal receipt is not a cash movement');
    await tick(); await markReimbursed(id, { how: 'cash', on: '2026-11-06', by: 'a' });
    equal((await bankrollSummary('2026-11-06')).cash, 220);
  } finally { done(); }
});

test('A RECEIPT NEEDS A TOTAL, A WAY OF PAYING, AND WHOSE POCKET', async () => {
  const { done } = await withTestDb();
  try {
    const bad = async (o) => { try { await createReceipt({ paidWith: 'cash', total: 10, ...o }); return ''; } catch (e) { return e.message; } };
    assert(/total/i.test(await bad({ total: 0 })));
    assert(/how it was paid/i.test(await bad({ paidWith: 'barter' })));
    assert(/own money/i.test(await bad({ paidWith: 'personal' })));
    assert(/tax cannot/i.test(await bad({ tax: 11 })));
  } finally { done(); }
});

test('cleanRead KEEPS ONLY WHAT IS PLAUSIBLE FROM THE MODEL', () => {
  const g = cleanRead('Here: {"vendor":"IKEA","date":"2026-11-02","total":"45.20","tax":5.2,"category":"Tools / supplies"}');
  equal(g.total, 45.2); equal(g.tax, 5.2); equal(g.vendor, 'IKEA'); equal(g.category, 'Tools / supplies');
  const h = cleanRead('{"total":10,"tax":99,"date":"yesterday","category":"Snacks"}');
  assert(h.tax === null && h.date === null && h.category === null, 'impossible tax, odd date and unknown category are dropped');
  assert(cleanRead('no json here').total === null);
});

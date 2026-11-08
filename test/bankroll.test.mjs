// The live bankroll, and the "patterns worth a rule" fix that stops the bank's own name being a pattern.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertExpense, suggestExpenseRules } from '../lib/finance.js';
import { setSetting } from '../lib/settings.js';
import { bankFigure, bankroll, looksCleared, addEntry, clearEntry, voidEntry, bankrollSummary, cashOnHand } from '../lib/bankroll.js';

const acct = (over) => ({ name: 'TD BUSINESS UNLIMITED', mask: '4676', type: 'depository', current: 100, available: 45, ...over });

suite('bankroll');

test('THE BANK FIGURE IS WHAT IS AVAILABLE, DEPOSIT ACCOUNTS ONLY, AND SAYS HOW OLD IT IS', () => {
  const f = bankFigure({ at: new Date(Date.now() - 10 * 60000).toISOString(), accounts: [acct(), acct({ available: 0, current: 0 }), { type: 'credit', current: 900, available: null }] });
  equal(f.available, 45); equal(f.current, 100);
  assert(!f.stale && f.minutesOld >= 10, 'ten minutes is fresh');
  assert(bankFigure({ at: new Date(Date.now() - 5 * 3600000).toISOString(), accounts: [acct()] }).stale, 'five hours is stale');
  assert(bankFigure(null).stale && bankFigure(null).available === null, 'no snapshot is unknown, not zero');
});

test('BANKROLL = BANK + CASH + MONEY ON ITS WAY', () => {
  const b = bankroll({ bank: 45, cash: 300.5, pending: -20.25 });
  equal(b.total, 325.25); assert(b.bankKnown);
  assert(!bankroll({ bank: null, cash: 10, pending: 0 }).bankKnown, 'unknown bank is flagged');
});

test('AN ENTRY IS HINTED AS CLEARED ONLY ON AN EXACT AMOUNT FROM ITS DATE ON', () => {
  const e = { amount: -113, date: '2026-11-05' };
  assert(looksCleared(e, [{ date: '2026-11-06', gross: 113, who: 'X' }]));
  assert(!looksCleared(e, [{ date: '2026-11-04', gross: 113 }]), 'older than the entry');
  assert(!looksCleared(e, [{ date: '2026-11-06', gross: 112.99 }]), 'not exact');
  assert(!looksCleared({ amount: 50, date: '2026-11-05' }, [{ date: '2026-11-06', gross: 50 }]), 'money in is never auto-hinted');
});

test('CASH IS UNKNOWN UNTIL SOMEONE COUNTS IT; THEN IT MOVES WITH SALES AND SPENDING', async () => {
  const { done } = await withTestDb();
  try {
    await setSetting('bank_balance_snapshot', { at: new Date().toISOString(), accounts: [acct()] });
    let s = await bankrollSummary('2026-11-06');
    assert(!s.cashKnown, 'no count, no cash figure');
    equal(s.total, 45);
    await addEntry({ date: '2026-11-06', kind: 'count', amount: 500, note: 'till', by: 'a' });
    const out = await addEntry({ date: '2026-11-06', kind: 'pending', amount: -113, note: 'sent Ravi', by: 'a' });
    const bad = await addEntry({ date: '2026-11-06', kind: 'pending', amount: -999, note: 'typo', by: 'a' });
    await voidEntry(bad, 'a');
    s = await bankrollSummary('2026-11-06');
    assert(s.cashKnown); equal(s.cash, 500); equal(s.pending, -113);
    equal(s.total, 432); // 45 + 500 - 113
    await clearEntry(out, 'a');
    s = await bankrollSummary('2026-11-06');
    equal(s.total, 545);
    let msg = ''; try { await clearEntry(out, 'a'); } catch (e) { msg = e.message; }
    assert(/already/.test(msg), 'cannot clear twice');
    let m2 = ''; try { await addEntry({ kind: 'cash', amount: 0 }); } catch (e) { m2 = e.message; }
    assert(/amount/i.test(m2), 'zero cash is refused');
    await addEntry({ date: '2026-11-06', kind: 'count', amount: 0, by: 'a' }); // an empty till is a real count
    equal((await bankrollSummary('2026-11-06')).cash, 0);
  } finally { done(); }
});

test('CASH SALES ALREADY IN THE SYSTEM RAISE THE CASH WITHOUT ANYONE TYPING THEM', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-06', kind: 'count', amount: 100, by: 'a' });
    await query(`INSERT INTO invoice_payments (invoice_id, amount, method, paid_at) VALUES (1, 250, 'cash', now() + interval '1 second'), (1, 400, 'etransfer', now() + interval '1 second')`);
    const s = await bankrollSummary('2026-11-06');
    equal(s.cash, 350, 'cash payment counted, the e-transfer is not cash');
    equal(s.day.cashIn.length >= 0, true);
  } finally { done(); }
});

test('cashOnHand IS PURE: COUNT + SALES + OTHER - SPENT, UNKNOWN WITHOUT A COUNT', () => {
  equal(cashOnHand({ count: 100, sales: 50, other: 25, spent: 40.5 }), 134.5);
  assert(cashOnHand({ count: null, sales: 50 }) === null);
});

test('THE DAY SHEET LISTS BANK LINES AND SHOWS THE HINT WHEN THE BANK CATCHES UP', async () => {
  const { done } = await withTestDb();
  try {
    await addEntry({ date: '2026-11-05', kind: 'pending', amount: -226, note: 'Ravi', by: 'a' });
    await upsertExpense({ incurredOn: '2026-11-06', category: 'Other', vendor: 'SEND E-TFR', amount: 226, tax: null, note: 'TD', extId: 'plaid:x1', source: 'plaid' });
    const s = await bankrollSummary('2026-11-06');
    equal(s.day.out.length, 1); equal(s.day.out[0].amount, -226);
    equal(s.entries.find((e) => e.kind === 'pending').bankShows.gross, 226);
  } finally { done(); }
});

test('PATTERNS NEVER GROUP LINES BY THE BANK AND ACCOUNT NAME THEY ALL SHARE', async () => {
  const { done } = await withTestDb();
  try {
    const note = 'TD Canada Trust · TD BUSINESS UNLIMITED ACCOUNT';
    const rows = [['BIG WAY HOT POT', 40], ['TDMS STMT OCT BUS', 39.95], ['MONTHLY PLAN FEE', 125], ['HOME DEPOT', 80]];
    let i = 0;
    for (const [vendor, amount] of rows) await upsertExpense({ incurredOn: '2026-11-0' + (++i), category: 'Other', vendor, amount, tax: null, note, extId: 'plaid:p' + i, source: 'plaid' });
    const s = await suggestExpenseRules({ minCount: 3 });
    assert(!s.some((g) => ['trust', 'td', 'business', 'unlimited', 'account'].includes(g.token)), 'no shared-bank-name pattern: ' + JSON.stringify(s.map((g) => g.token)));
    equal(s.length, 0, 'four unrelated lines are not a pattern');
  } finally { done(); }
});

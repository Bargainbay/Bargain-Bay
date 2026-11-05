// Splitting one bank line into several, and reading the bank's balances.
// The parts must add back to the bank's charge to the cent; the bank feed must
// not write the full amount back over a split; Undo restores the line exactly.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import {
  upsertExpense, listExpenses, splitExpense, unsplitExpense, splitExtIds,
  deleteExpenseByExtId, deleteExpense
} from '../lib/finance.js';
import { plaidBalances } from '../lib/plaid.js';

const bankLine = (extId = 'plaid:abc', amount = 226) => upsertExpense({
  incurredOn: '2026-11-03', category: 'Other', vendor: 'HOME DEPOT', amount, tax: null,
  note: 'TD', extId, source: 'plaid'
});
const idOf = async (extId) => (await query('SELECT id FROM expenses WHERE ext_id = $1', [extId])).rows[0].id;
const sum = (rows) => Math.round(rows.reduce((a, r) => a + r.amount + (r.tax || 0), 0) * 100) / 100;

suite('splitting a bank line');

test('THE PARTS MUST ADD BACK TO THE BANK LINE, TO THE CENT', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine();
    const id = await idOf('plaid:abc');
    let msg = '';
    try { await splitExpense(id, [{ amount: 100, category: 'Tools / supplies' }, { amount: 100, category: 'Other' }]); } catch (e) { msg = e.message; }
    assert(/add up to \$200\.00 but the bank line is \$226\.00/.test(msg), 'a short split is refused: ' + msg);
    equal((await listExpenses(10)).length, 1, 'nothing was written');
    equal((await listExpenses(10))[0].split, null);
  } finally { done(); }
});

test('A SPLIT KEEPS THE TOTAL, GIVES EACH PART ITS OWN CATEGORY AND TAX, AND FLAGS THE ROWS', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine();
    const id = await idOf('plaid:abc');
    await splitExpense(id, [
      { amount: 113, category: 'Tools / supplies', taxMode: 'hst' },
      { amount: 100, category: 'Fuel / delivery', taxMode: 'none' },
      { amount: 13, category: 'Other', taxMode: 'review' }
    ]);
    const rows = await listExpenses(10);
    equal(rows.length, 3);
    equal(sum(rows), 226, 'the three parts are still what the bank took');
    const parent = rows.find((r) => r.id === id);
    equal(parent.split, 'parent');
    equal(parent.category, 'Tools / supplies');
    equal(parent.amount, 100, '113 with 13% inside is 100 + 13');
    equal(parent.tax, 13);
    const kids = rows.filter((r) => r.split === 'child');
    equal(kids.length, 2);
    const fuel = kids.find((r) => r.category === 'Fuel / delivery');
    equal(fuel.amount, 100); equal(fuel.tax, 0, 'checked, none');
    const later = kids.find((r) => r.category === 'Other');
    equal(later.tax, null, 'null is "nobody has looked", not zero');
    assert((await splitExtIds()).has('plaid:abc'), 'the feed is told to leave it alone');
  } finally { done(); }
});

test('A LINE CANNOT BE SPLIT TWICE, AND A PART CANNOT BE SPLIT AGAIN', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine();
    const id = await idOf('plaid:abc');
    await splitExpense(id, [{ amount: 126 }, { amount: 100 }]);
    let a = '', b = '';
    try { await splitExpense(id, [{ amount: 126 }, { amount: 100 }]); } catch (e) { a = e.message; }
    assert(/already split/.test(a), a);
    const kid = (await listExpenses(10)).find((r) => r.split === 'child');
    try { await splitExpense(kid.id, [{ amount: 50 }, { amount: 50 }]); } catch (e) { b = e.message; }
    assert(/already one part/.test(b), b);
  } finally { done(); }
});

test('UNDO PUTS THE BANK LINE BACK EXACTLY AND DROPS THE OTHER PARTS', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine();
    const id = await idOf('plaid:abc');
    await splitExpense(id, [{ amount: 126, category: 'Fees', taxMode: 'none' }, { amount: 100, category: 'Fees', taxMode: 'none' }]);
    await unsplitExpense(id);
    const rows = await listExpenses(10);
    equal(rows.length, 1);
    equal(rows[0].amount, 226); equal(rows[0].tax, null); equal(rows[0].category, 'Other');
    equal(rows[0].note, 'TD', 'the note is not left saying "split"');
    equal(rows[0].split, null);
    assert(!(await splitExtIds()).has('plaid:abc'));
  } finally { done(); }
});

test('IF THE BANK RETRACTS A SPLIT CHARGE, ALL ITS PARTS GO WITH IT', async () => {
  const { done } = await withTestDb();
  try {
    await bankLine();
    const id = await idOf('plaid:abc');
    await splitExpense(id, [{ amount: 126 }, { amount: 100 }]);
    await deleteExpenseByExtId('plaid:abc');
    equal((await listExpenses(10)).length, 0, 'no orphan part is left claiming a share of a charge that is gone');
    await bankLine('plaid:def');
    const id2 = await idOf('plaid:def');
    await splitExpense(id2, [{ amount: 126 }, { amount: 100 }]);
    await deleteExpense(id2);
    equal((await listExpenses(10)).length, 0, 'deleting the first part by hand does the same');
  } finally { done(); }
});

test('A MANUAL ROW CAN BE SPLIT TOO, AND ITS PARTS CARRY NO FEED ID', async () => {
  const { done } = await withTestDb();
  try {
    await query(`INSERT INTO expenses (incurred_on, category, vendor, amount, tax) VALUES ('2026-11-01','Other','Cash',50,0)`);
    const id = (await query('SELECT id FROM expenses')).rows[0].id;
    await splitExpense(id, [{ amount: 30, taxMode: 'none' }, { amount: 20, taxMode: 'none' }]);
    const r = (await query('SELECT ext_id FROM expenses')).rows;
    equal(r.length, 2); assert(r.every((x) => x.ext_id == null));
  } finally { done(); }
});

suite('bank balances');

test('BALANCES COME BACK PER ACCOUNT, A CARD IS LABELLED BY ITS TYPE, AND ONE BANK FAILING DOES NOT HIDE THE OTHER', async () => {
  const { done } = await withTestDb();
  const realFetch = globalThis.fetch;
  const env = { id: process.env.PLAID_CLIENT_ID, sec: process.env.PLAID_SECRET };
  try {
    process.env.PLAID_CLIENT_ID = 'cid'; process.env.PLAID_SECRET = 'sec';
    const { setSetting } = await import('../lib/settings.js');
    await setSetting('plaid_items', [
      { itemId: 'i1', accessToken: 'tok1', institution: 'TD' },
      { itemId: 'i2', accessToken: 'tok2', institution: 'Other Bank' }
    ]);
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (!String(url).endsWith('/accounts/get')) return { ok: false, status: 404, json: async () => ({}) };
      if (body.access_token === 'tok2') return { ok: false, status: 400, json: async () => ({ error_message: 'login required' }) };
      return {
        ok: true, status: 200,
        json: async () => ({ accounts: [
          { account_id: 'a1', name: 'Chequing', mask: '1234', type: 'depository', balances: { current: 1200.5, available: 1100, iso_currency_code: 'CAD' } },
          { account_id: 'a2', name: 'Visa', mask: '9999', type: 'credit', balances: { current: 300, available: null, iso_currency_code: 'CAD' } }
        ] })
      };
    };
    const r = await plaidBalances();
    equal(r.accounts.length, 2);
    equal(r.accounts[0].current, 1200.5); equal(r.accounts[0].institution, 'TD');
    equal(r.accounts[1].type, 'credit'); equal(r.accounts[1].available, null);
    equal(r.errors.length, 1);
    assert(/Other Bank: login required/.test(r.errors[0]), r.errors[0]);
  } finally {
    globalThis.fetch = realFetch;
    if (env.id === undefined) delete process.env.PLAID_CLIENT_ID; else process.env.PLAID_CLIENT_ID = env.id;
    if (env.sec === undefined) delete process.env.PLAID_SECRET; else process.env.PLAID_SECRET = env.sec;
    done();
  }
});

suite('the bank feed and a split');

test('A CHANGED BANK LINE DOES NOT WRITE THE FULL AMOUNT BACK OVER A SPLIT', async () => {
  const { done } = await withTestDb();
  const realFetch = globalThis.fetch;
  const env = { id: process.env.PLAID_CLIENT_ID, sec: process.env.PLAID_SECRET };
  try {
    process.env.PLAID_CLIENT_ID = 'cid'; process.env.PLAID_SECRET = 'sec';
    const { setSetting } = await import('../lib/settings.js');
    const { syncPlaidTransactions } = await import('../lib/plaid.js');
    await setSetting('plaid_items', [{ itemId: 'i1', accessToken: 'tok1', institution: 'TD', cursor: null, detailsV: 2 }]);
    await setSetting('ledger_start', '2026-01-01');
    const tx = { transaction_id: 'abc', amount: 226, date: '2026-11-03', name: 'HOME DEPOT', pending: false,
      personal_finance_category: { primary: 'GENERAL_MERCHANDISE' } };
    let page = 0;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => (page++ === 0
        ? { added: [tx], modified: [], removed: [], next_cursor: 'c1', has_more: false }
        : { added: [], modified: [{ ...tx }], removed: [], next_cursor: 'c2', has_more: false })
    });
    await syncPlaidTransactions();
    const id = (await query('SELECT id FROM expenses WHERE ext_id = $1', ['plaid:abc'])).rows[0].id;
    await splitExpense(id, [{ amount: 126, category: 'Fees', taxMode: 'none' }, { amount: 100, category: 'Other', taxMode: 'none' }]);
    const r = await syncPlaidTransactions();
    equal(r.updated, 0, 'the modified line was left alone');
    const rows = await listExpenses(10);
    equal(rows.length, 2);
    equal(sum(rows), 226, 'still counted once');
  } finally {
    globalThis.fetch = realFetch;
    if (env.id === undefined) delete process.env.PLAID_CLIENT_ID; else process.env.PLAID_CLIENT_ID = env.id;
    if (env.sec === undefined) delete process.env.PLAID_SECRET; else process.env.PLAID_SECRET = env.sec;
    done();
  }
});

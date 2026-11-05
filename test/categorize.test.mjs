// Categorising the bank feed at scale: grouping by payee, bulk decisions with HST,
// what the bank feed may and may not overwrite, undo, and the details kept per line.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { bankKey, payeeKey, rulePrefix } from '../lib/payee.js';
import {
  upsertExpense, listForCategorize, payeeGroups, categorizeStats, bulkCategorize, restoreCategorized,
  annotateExpenses, markNeedsReview, listExpenseRules, EXPENSE_CATEGORIES
} from '../lib/finance.js';
import { mapTransaction } from '../lib/plaid.js';

const line = (id, over = {}) => upsertExpense({
  incurredOn: '2026-11-02', category: 'Other', vendor: 'HOME DEPOT #7045', amount: 113, tax: null, note: 'TD',
  extId: `plaid:${id}`, source: 'plaid', catSource: 'guess', accountLabel: 'Chequing ····1234', bankDesc: 'HOME DEPOT #7045 TORONTO', ...over
});
const idOf = async (id) => (await query('SELECT id FROM expenses WHERE ext_id = $1', [`plaid:${id}`])).rows[0].id;
const row = async (id) => (await query('SELECT * FROM expenses WHERE ext_id = $1', [`plaid:${id}`])).rows[0];

suite('payee keys — a thousand lines are a few dozen payees');

test('NOISE IS STRIPPED SO THE SAME PAYEE ALWAYS HAS THE SAME KEY', () => {
  equal(bankKey('HOME DEPOT #7045 TORONTO'), 'home depot toronto');
  equal(bankKey('MRCH29474100013 MSP'), 'msp', 'a merchant id changes, the name does not');
  equal(bankKey('SEND E-TFR *nMU EXP'), 'send e tfr exp', 'the reference code is unique to one transfer');
  equal(bankKey('SEND E-TFR *Vav EXP'), bankKey('SEND E-TFR *nMU EXP'), 'so two transfers with the same memo group together');
  equal(payeeKey({ vendor: 'SEND E-TFR *Vav SUPP' }), 'send e tfr supp');
  equal(payeeKey({ payeeOverride: 'Ravi Appliances', vendor: 'SEND E-TFR *Vav SUPP' }), 'ravi appliances', 'a name a person typed wins');
});

test('A RULE IS ONLY OFFERED WHEN THE TEXT IDENTIFIES SOMEBODY, AND IS LITERALLY IN THE DESCRIPTOR', () => {
  equal(rulePrefix('HOME DEPOT #7045 TORONTO'), 'home depot');
  equal(rulePrefix('Big Way Hot Pot'), 'big way hot pot');
  equal(rulePrefix('SEND E-TFR *nMU EXP'), null, 'a rule on "send e-tfr" would sweep up every transfer in the account');
  equal(rulePrefix('MRCH29474100013 MSP'), null);
});

test('THE CATEGORY LIST IS THE COSTS SECTION\'S WORDING, AND INTEREST CANNOT BE MISTAKEN FOR A LOAN REPAYMENT', () => {
  for (const c of ['Utilities', 'Insurance', 'Software', 'Truck (lease, plates, upkeep)', 'Advertising', 'Card & bank fees']) assert(EXPENSE_CATEGORIES.includes(c), c);
  assert(!EXPENSE_CATEGORIES.includes('Marketing') && !EXPENSE_CATEGORIES.includes('Fees'), 'the duplicates are merged');
  // the ledger routes any category matching /loan|repayment/ to the loan liability
  const interest = EXPENSE_CATEGORIES.find((c) => /interest/i.test(c));
  assert(interest && !/loan|repayment/i.test(interest), interest);
});

suite('the review queue');

test('ONLY THE BANK\'S OWN GUESS NEEDS A PERSON; A RULE\'S DECISION AND TYPED ENTRIES DO NOT', async () => {
  const { done } = await withTestDb();
  try {
    await line('a'); // guess
    await line('b', { category: 'Fuel / delivery', catSource: 'rule' });
    await query(`INSERT INTO expenses (incurred_on, category, vendor, amount, source, cat_source, reviewed_at) VALUES ('2026-11-01','Rent / storage','Landlord',1000,'manual','manual',now())`);
    const s = await categorizeStats();
    equal(s.toReview, 1); equal(s.reviewed, 2); equal(s.total, 3);
    equal((await listForCategorize({ status: 'review' })).rows.length, 1);
    equal((await listForCategorize({ status: 'rules' })).rows.length, 1);
    equal((await listForCategorize({ status: 'all' })).total, 3);
  } finally { done(); }
});

test('SEARCH FINDS A PAYEE, A MEMO, A NOTE OR AN AMOUNT, AND ACCOUNT / DATE / SIZE FILTERS NARROW IT', async () => {
  const { done } = await withTestDb();
  try {
    await line('a', { memo: 'invoice 4471', amount: 100 });
    await line('b', { vendor: 'ESSO #22', bankDesc: 'ESSO #22', amount: 50, accountLabel: 'Visa ····9999', incurredOn: '2026-10-05' });
    const q = async (f) => (await listForCategorize({ status: 'all', ...f })).rows.length;
    equal(await q({ q: 'home depot' }), 1);
    equal(await q({ q: 'invoice 4471' }), 1, 'the bank memo is searchable');
    equal(await q({ q: '50' }), 1, 'so is the amount');
    equal(await q({ account: 'Visa ····9999' }), 1);
    equal(await q({ from: '2026-11-01' }), 1);
    equal(await q({ min: '60' }), 1);
    equal(await q({ category: '__none' }), 0);
  } finally { done(); }
});

suite('grouping by payee');

test('LINES WITH DIFFERENT MERCHANT IDS AND TRANSFER CODES FOLD INTO ONE PAYEE EACH', async () => {
  const { done } = await withTestDb();
  try {
    await line('m1', { vendor: 'MRCH29474100013 MSP', bankDesc: 'MRCH29474100013 MSP', amount: 40 });
    await line('m2', { vendor: 'MRCH29474100099 MSP', bankDesc: 'MRCH29474100099 MSP', amount: 60 });
    await line('t1', { vendor: 'SEND E-TFR *nMU EXP', bankDesc: 'SEND E-TFR *nMU EXP', amount: 500 });
    await line('t2', { vendor: 'SEND E-TFR *Vav EXP', bankDesc: 'SEND E-TFR *Vav EXP', amount: 300 });
    await line('t3', { vendor: 'SEND E-TFR *Q9z SUPP', bankDesc: 'SEND E-TFR *Q9z SUPP', amount: 1356 });
    const g = (await payeeGroups({ status: 'review' })).groups;
    equal(g.length, 3, 'five lines, three payees');
    equal(g[0].label.includes('SUPP'), true, 'largest total first');
    const exp = g.find((x) => x.key === 'send e tfr exp');
    equal(exp.count, 2); equal(exp.total, 800);
    equal(exp.canRule, false, 'a rule on a bare transfer is not offered');
    equal(g.find((x) => x.key === 'msp').count, 2);
  } finally { done(); }
});

test('A PAYEE ALREADY SETTLED BEFORE IS SUGGESTED ON THE NEXT LINE FROM THEM', async () => {
  const { done } = await withTestDb();
  try {
    await line('a'); await line('b');
    await bulkCategorize({ ids: [await idOf('a')], category: 'Tools / supplies' });
    const r = (await listForCategorize({ status: 'review' })).rows;
    equal(r.length, 1); equal(r[0].suggest, 'Tools / supplies'); equal(r[0].suggestN, 1);
    equal((await payeeGroups({ status: 'review' })).groups[0].suggest, 'Tools / supplies');
  } finally { done(); }
});

suite('deciding many at once');

test('BULK: CATEGORY AND HST ARE SET TOGETHER, THE TOTAL NEVER MOVES, AND THE LINES LEAVE THE QUEUE', async () => {
  const { done } = await withTestDb();
  try {
    await line('a', { amount: 113 }); await line('b', { amount: 226 }); await line('c', { amount: 50 });
    const ids = [await idOf('a'), await idOf('b'), await idOf('c')];
    const r = await bulkCategorize({ ids: ids.slice(0, 2), category: 'Tools / supplies', taxMode: 'hst', by: 'acct@x.ca' });
    equal(r.updated, 2);
    const a = await row('a'), b = await row('b'), c = await row('c');
    equal(Number(a.amount), 100); equal(Number(a.tax), 13); equal(a.category, 'Tools / supplies');
    equal(Number(b.amount), 200); equal(Number(b.tax), 26);
    equal(a.cat_source, 'bulk'); equal(a.reviewed_by, 'acct@x.ca'); assert(a.reviewed_at);
    equal(c.reviewed_at, null, 'the untouched line is still waiting');
    await bulkCategorize({ ids: [ids[2]], category: 'Fuel / delivery', taxMode: 'none' });
    equal(Number((await row('c')).tax), 0); equal(Number((await row('c')).amount), 50);
    await bulkCategorize({ ids: [ids[0]], category: 'Fuel / delivery', taxMode: 'review' });
    const a2 = await row('a');
    equal(a2.tax, null, 'back to "nobody has said"'); equal(Number(a2.amount), 113, 'and the full charge again');
    await bulkCategorize({ ids: [ids[1]], category: 'Wages' }); // no taxMode
    equal(Number((await row('b')).tax), 26, 'leaving the HST alone leaves it alone');
  } finally { done(); }
});

test('REMEMBER THIS PAYEE SAVES A RULE WITH TEXT THAT IS IN THE DESCRIPTOR, AND NONE FOR A BARE TRANSFER', async () => {
  const { done } = await withTestDb();
  try {
    await line('a'); await line('t', { vendor: 'SEND E-TFR *nMU EXP', bankDesc: 'SEND E-TFR *nMU EXP' });
    const r = await bulkCategorize({ ids: [await idOf('a'), await idOf('t')], category: 'Tools / supplies', taxMode: 'hst', makeRule: true });
    equal(r.rules.length, 1); equal(r.rules[0], 'home depot');
    const rules = await listExpenseRules();
    equal(rules.length, 1); equal(rules[0].match, 'home depot'); equal(rules[0].category, 'Tools / supplies'); equal(rules[0].taxMode, 'hst');
  } finally { done(); }
});

test('UNDO PUTS EVERY LINE BACK EXACTLY — CATEGORY, AMOUNT, HST AND STATUS', async () => {
  const { done } = await withTestDb();
  try {
    await line('a'); await line('b');
    const ids = [await idOf('a'), await idOf('b')];
    const r = await bulkCategorize({ ids, category: 'Insurance', taxMode: 'hst' });
    await restoreCategorized(r.before);
    const a = await row('a');
    equal(a.category, 'Other'); equal(Number(a.amount), 113); equal(a.tax, null); equal(a.reviewed_at, null); equal(a.cat_source, 'guess');
    equal((await categorizeStats()).toReview, 2);
  } finally { done(); }
});

test('PUT BACK IN REVIEW, AND BAD INPUT IS REFUSED', async () => {
  const { done } = await withTestDb();
  try {
    await line('a');
    const id = await idOf('a');
    await bulkCategorize({ ids: [id], category: 'Insurance' });
    await markNeedsReview([id]);
    equal((await categorizeStats()).toReview, 1);
    let m1 = '', m2 = '';
    try { await bulkCategorize({ ids: [], category: 'Insurance' }); } catch (e) { m1 = e.message; }
    try { await bulkCategorize({ ids: [id], category: '' }); } catch (e) { m2 = e.message; }
    assert(/at least one/.test(m1)); assert(/category/i.test(m2));
  } finally { done(); }
});

suite('what the bank feed may overwrite');

test('A DECISION IS NEVER UNDONE BY THE BANK RE-SENDING THE LINE, AND THE HST SPLIT IS NOT COUNTED TWICE', async () => {
  const { done } = await withTestDb();
  try {
    await line('a', { amount: 113 });
    await bulkCategorize({ ids: [await idOf('a')], category: 'Insurance', taxMode: 'hst' });
    await line('a', { amount: 113, category: 'Other' }); // the bank re-sends it, same total
    const a = await row('a');
    equal(a.category, 'Insurance', 'category kept'); equal(Number(a.amount), 100, 'pre-tax kept'); equal(Number(a.tax), 13, 'tax kept');
    assert(a.reviewed_at, 'still reviewed');
    await line('a', { amount: 150, category: 'Other' }); // the bank changes the amount
    const b = await row('a');
    equal(Number(b.amount), 150); equal(b.tax, null, 'a different charge needs its HST looked at again');
    equal(b.category, 'Insurance', 'but the category decision still stands');
  } finally { done(); }
});

test('A NAME A PERSON TYPED SURVIVES THE FEED, AND CLEARING IT RESTORES THE BANK\'S', async () => {
  const { done } = await withTestDb();
  try {
    await line('a', { vendor: 'SEND E-TFR *nMU SUPP', bankDesc: 'SEND E-TFR *nMU SUPP', payee: null });
    const id = await idOf('a');
    await annotateExpenses({ ids: [id], payee: 'Ravi Appliances', userNote: 'Oct fridge lot' });
    equal((await row('a')).vendor, 'Ravi Appliances');
    await line('a', { vendor: 'SEND E-TFR *nMU SUPP', bankDesc: 'SEND E-TFR *nMU SUPP', payee: null });
    const r = await row('a');
    equal(r.vendor, 'Ravi Appliances', 'the re-sync did not rename it'); equal(r.user_note, 'Oct fridge lot');
    const listed = (await listForCategorize({ status: 'all' })).rows[0];
    equal(listed.label, 'Ravi Appliances'); equal(listed.key, 'ravi appliances');
    await annotateExpenses({ ids: [id], payee: '' });
    equal((await row('a')).payee_override, null);
  } finally { done(); }
});

suite('what the bank told us');

test('PAYEE, MEMO, ACCOUNT AND THE RAW BANK FIELDS ARE KEPT ON EVERY LINE', () => {
  const m = mapTransaction({
    transaction_id: 'x1', amount: 226, date: '2026-11-03', name: 'SEND E-TFR *nMU EXP', merchant_name: null,
    original_description: 'SEND E-TFR *nMU EXP', account_id: 'acc1', payment_channel: 'online',
    counterparties: [{ name: 'Ravi Appliances', type: 'merchant' }],
    payment_meta: { reason: 'invoice 4471', reference_number: 'R-9', payer: null },
    personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', confidence_level: 'LOW' }
  }, 'TD', { accounts: new Map([['acc1', 'Chequing ····1234']]) });
  // TRANSFER_OUT is not a cost, so this exact line is skipped — use one that is:
  equal(m, null);
  const k = mapTransaction({
    transaction_id: 'x2', amount: 226, date: '2026-11-03', name: 'SEND E-TFR *nMU EXP', original_description: 'SEND E-TFR *nMU EXP',
    account_id: 'acc1', counterparties: [{ name: 'Ravi Appliances', type: 'merchant' }],
    payment_meta: { reason: 'invoice 4471', reference_number: 'R-9', payer: null },
    personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER', confidence_level: 'LOW' }
  }, 'TD', { accounts: new Map([['acc1', 'Chequing ····1234']]) });
  equal(k.payee, 'Ravi Appliances'); equal(k.memo, 'invoice 4471'); equal(k.accountLabel, 'Chequing ····1234');
  equal(k.bankDesc, 'SEND E-TFR *nMU EXP'); equal(k.catSource, 'guess'); equal(k.category, 'Card & bank fees');
  equal(k.bank.payment_meta.reference_number, 'R-9'); assert(!('payer' in k.bank.payment_meta), 'empty fields are dropped');
  equal(k.bank.category.confidence, 'LOW');
});

test('A RULE-SORTED LINE COUNTS AS DECIDED; A BANK GUESS DOES NOT', () => {
  const t = { transaction_id: 'r1', amount: 20, date: '2026-11-03', name: 'ESSO 22', personal_finance_category: { primary: 'TRANSPORTATION' } };
  equal(mapTransaction(t, 'TD', { rules: [{ match: 'esso', category: 'Fuel / delivery', taxMode: null }] }).catSource, 'rule');
  equal(mapTransaction(t, 'TD', { rules: [] }).catSource, 'guess');
});

test('RE-READING THE BANK FILLS IN DETAILS BUT NEITHER BRINGS BACK A DELETED LINE NOR TOUCHES A DECISION', async () => {
  const { done } = await withTestDb();
  const realFetch = globalThis.fetch;
  const env = { id: process.env.PLAID_CLIENT_ID, sec: process.env.PLAID_SECRET };
  try {
    process.env.PLAID_CLIENT_ID = 'cid'; process.env.PLAID_SECRET = 'sec';
    const { setSetting } = await import('../lib/settings.js');
    const { syncPlaidTransactions } = await import('../lib/plaid.js');
    await setSetting('plaid_items', [{ itemId: 'i1', accessToken: 'tok', institution: 'TD', cursor: 'old' }]); // no detailsV: needs the re-read
    await setSetting('ledger_start', '2026-01-01');
    await line('kept', { payee: null, bankDesc: null, accountLabel: null, amount: 113 });
    await bulkCategorize({ ids: [await idOf('kept')], category: 'Insurance', taxMode: 'hst' });
    const tx = (id, name) => ({ transaction_id: id, amount: 113, date: '2026-11-02', name, original_description: `${name} FULL`, account_id: 'a1',
      counterparties: [{ name: 'Acme', type: 'merchant' }], personal_finance_category: { primary: 'GENERAL_SERVICES' } });
    let sentCursor;
    globalThis.fetch = async (url, opts) => {
      const b = JSON.parse(opts.body); sentCursor = b.cursor; 
      return { ok: true, status: 200, json: async () => ({ added: [tx('kept', 'HOME DEPOT'), tx('deleted', 'GONE LTD')], modified: [], removed: [], next_cursor: 'c9', has_more: false,
        accounts: [{ account_id: 'a1', name: 'Chequing', mask: '1234' }] }) };
    };
    await syncPlaidTransactions();
    equal(sentCursor, undefined, 'it started the read over');
    const k = await row('kept');
    equal(k.payee, 'Acme'); equal(k.account_label, 'Chequing ····1234'); equal(k.bank_desc, 'HOME DEPOT FULL');
    equal(k.category, 'Insurance'); equal(Number(k.amount), 100); equal(Number(k.tax), 13);
    equal(Number((await query('SELECT count(*) AS c FROM expenses WHERE ext_id = $1', ['plaid:deleted'])).rows[0].c), 0, 'a line that is not in the ledger stays out');
    const items = await (await import('../lib/settings.js')).getSetting('plaid_items', []);
    equal(items[0].detailsV, 2, 'and it is not repeated next time');
  } finally {
    globalThis.fetch = realFetch;
    if (env.id === undefined) delete process.env.PLAID_CLIENT_ID; else process.env.PLAID_CLIENT_ID = env.id;
    if (env.sec === undefined) delete process.env.PLAID_SECRET; else process.env.PLAID_SECRET = env.sec;
    done();
  }
});

suite('sorting rules');

test('A RULE CAN BE SAVED, AND SAVING THE SAME TEXT AGAIN UPDATES IT INSTEAD OF FAILING', async () => {
  const { done } = await withTestDb();
  try {
    const { saveExpenseRule } = await import('../lib/finance.js');
    const id1 = await saveExpenseRule({ match: 'Home Depot', category: 'Tools / supplies' });
    const id2 = await saveExpenseRule({ match: 'home depot', category: 'Insurance', taxMode: 'hst' });
    equal(id1, id2, 'case-insensitive, one rule');
    const rules = await listExpenseRules();
    equal(rules.length, 1); equal(rules[0].category, 'Insurance');
  } finally { done(); }
});

test('A NEW RULE SORTS THE LINES ALREADY IN THE LEDGER, TAKES THEM OFF THE QUEUE, AND LEAVES HAND-PICKED ONES ALONE', async () => {
  const { done } = await withTestDb();
  try {
    const { saveExpenseRule, applyRulesToExisting } = await import('../lib/finance.js');
    await line('a'); await line('b');
    await bulkCategorize({ ids: [await idOf('b')], category: 'Other' }); // a deliberate "Other"
    await saveExpenseRule({ match: 'home depot', category: 'Tools / supplies' });
    const r = await applyRulesToExisting();
    equal(r.categorised, 1);
    const a = await row('a'), b = await row('b');
    equal(a.category, 'Tools / supplies'); equal(a.cat_source, 'rule'); assert(a.reviewed_at);
    equal(b.category, 'Other'); equal(b.cat_source, 'bulk');
  } finally { done(); }
});

suite('who it was sent to');

test('A GROUP SAYS WHETHER THE BANK NAMES ANYONE, AND NAMING A LINE MOVES IT INTO THAT PERSON\'S GROUP', async () => {
  const { done } = await withTestDb();
  try {
    await line('t1', { vendor: 'SEND E-TFR *nMU SUPP', bankDesc: 'SEND E-TFR *nMU SUPP', payee: null });
    await line('t2', { vendor: 'SEND E-TFR *Vav SUPP', bankDesc: 'SEND E-TFR *Vav SUPP', payee: null });
    await line('h', { payee: 'Big Way Hot Pot', vendor: 'Big Way Hot Pot', bankDesc: 'BIG WAY HOT POT' });
    let g = (await payeeGroups({ status: 'review' })).groups;
    equal(g.find((x) => x.key === 'send e tfr supp').named, 0, 'the bank says nothing about who');
    equal(g.find((x) => x.key === 'big way hot pot').named, 1);
    await annotateExpenses({ ids: [await idOf('t1')], payee: 'Ravi Appliances' });
    g = (await payeeGroups({ status: 'review' })).groups;
    equal(g.find((x) => x.key === 'send e tfr supp').count, 1, 'one transfer left unnamed');
    const ravi = g.find((x) => x.key === 'ravi appliances');
    equal(ravi.count, 1); equal(ravi.named, 1);
  } finally { done(); }
});

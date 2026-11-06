// Store credit: a cancelled order's deposit, less the restocking fee, becomes a
// transferable code with no expiry. The balance is a SUM of an append-only table;
// spending it is a tender on the new invoice (not a discount); and the ledger
// carries it as a liability (2170) that equals every code's balance.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { sharedCheckoutDb } from './shared-checkout-db.mjs';
import { query, withTransaction } from '../lib/db.js';
import {
  issueStoreCredit, getStoreCredit, spendStoreCredit, restoreStoreCredit,
  normalizeCreditCode, storeCreditOutstanding
} from '../lib/store-credit.js';
import { createAndSendInvoice, recordInvoicePayment, refundInvoiceAmount, applyStoreCreditToInvoice } from '../lib/invoices.js';
import { trialBalance, setOpeningBalances } from '../lib/ledger.js';

const fresh = () => withTestDb();
const rawInvoice = (amount) => createAndSendInvoice({
  name: 'Sam Buyer', email: 'sam@example.com', items: [{ description: 'Delivery', amount, kind: 'service' }],
  addHst: false, sendEmail: false, createdBy: { email: 'rep@rssolutions.ca', name: 'Rep' }
});

suite('store credit — codes and balance');

test('A CODE IS READ BACK THE SAME WHATEVER THE CUSTOMER TYPES', () => {
  equal(normalizeCreditCode('sc-abcd-2345'), 'SC-ABCD-2345');
  equal(normalizeCreditCode('abcd 2345'), 'SC-ABCD-2345');
  equal(normalizeCreditCode('SCABCD2345'), 'SC-ABCD-2345');
  equal(normalizeCreditCode('nope'), null);
});

test('THE BALANCE IS A SUM, AND NOBODY CAN SPEND MORE THAN IT HOLDS', async () => {
  const { done } = await fresh();
  try {
    const c = await issueStoreCredit({ amount: 100, email: 'a@b.ca', name: 'A', by: 'rep@x.ca' });
    equal((await getStoreCredit(c.code)).balance, 100);
    await withTransaction((cl) => spendStoreCredit(cl, c.code, 30, { exact: true }));
    equal((await getStoreCredit(c.code)).balance, 70);
    let refused = '';
    try { await withTransaction((cl) => spendStoreCredit(cl, c.code, 80, { exact: true })); } catch (e) { refused = e.message; }
    assert(/only has/.test(refused), 'overspend is refused: ' + refused);
    const part = await withTransaction((cl) => spendStoreCredit(cl, c.code, 500));
    equal(part.taken, 70, 'without exact it takes what is there, never more');
    equal((await getStoreCredit(c.code)).balance, 0);
  } finally { done(); }
});

test('THE ENTRIES TABLE IS APPEND-ONLY', async () => {
  const { done } = await fresh();
  try {
    const c = await issueStoreCredit({ amount: 50 });
    let blocked = false;
    try { await query('UPDATE store_credit_entries SET amount = 5000 WHERE credit_id = $1', [c.id]); } catch { blocked = true; }
    assert(blocked, 'an edit must be refused');
    blocked = false;
    try { await query('DELETE FROM store_credit_entries WHERE credit_id = $1', [c.id]); } catch { blocked = true; }
    assert(blocked, 'a delete must be refused');
  } finally { done(); }
});

test('A RESTORE IS A NEW ROW, NOT AN EDIT', async () => {
  const { done } = await fresh();
  try {
    const c = await issueStoreCredit({ amount: 40 });
    await withTransaction((cl) => spendStoreCredit(cl, c.code, 40));
    await restoreStoreCredit(c.code, 40, { note: 'sale fell through' });
    equal((await getStoreCredit(c.code)).balance, 40);
    equal(await storeCreditOutstanding(), 40);
  } finally { done(); }
});

suite('store credit — refunds into it, and paying with it');

// One database for all of this: lib/invoices memoises its runtime schema in module scope, so a
// second fresh database would never get its columns (the same gotcha the checkout tests note).
test('DEPOSIT -> CREDIT CODE -> PAYS A LATER INVOICE, AND THE LEDGER CARRIES IT', async () => {
  // The shared database, not a fresh one: other files in this process have already memoised lib/invoices'
  // runtime schema against it.
  await sharedCheckoutDb();
  try {
    const first = await rawInvoice(1000);
    await recordInvoicePayment(first.id, { amount: 400, method: 'etransfer' });
    // Cancellation: 20% of the $400 deposit is kept, the other $320 becomes credit.
    const r = await refundInvoiceAmount(first.id, { amount: 320, reason: 'Cancelled', by: 'rep@x.ca', asCredit: true });
    assert(r.storeCredit && r.storeCredit.code, 'a code is issued');
    equal(r.storeCredit.amount, 320);
    const { rows } = await query('SELECT to_credit FROM invoice_refunds WHERE invoice_id = $1', [first.id]);
    equal(rows[0].to_credit, true, 'the refund row says it went to credit, not to the bank');

    const second = await rawInvoice(500);
    const paid = await applyStoreCreditToInvoice(second.id, r.storeCredit.code, { by: 'rep@x.ca' });
    equal(paid.creditUsed, 320);
    equal(paid.status, 'partial', 'credit short of the total leaves a balance');
    equal((await getStoreCredit(r.storeCredit.code)).balance, 0);

    const third = await rawInvoice(100);
    let refused = '';
    try { await applyStoreCreditToInvoice(third.id, r.storeCredit.code); } catch (e) { refused = e.message; }
    assert(/no balance/.test(refused), 'a spent credit pays nothing: ' + refused);

    // A credit bigger than the invoice settles it and only the total is taken.
    // Credit only ever comes from a refund, which is what the ledger journals.
    const dep = await rawInvoice(900);
    await recordInvoicePayment(dep.id, { amount: 250, method: 'cash' });
    const c = (await refundInvoiceAmount(dep.id, { amount: 200, asCredit: true })).storeCredit;
    const small = await rawInvoice(150);
    const paidSmall = await applyStoreCreditToInvoice(small.id, c.code);
    equal(paidSmall.fullyPaid, true);
    equal((await getStoreCredit(c.code)).balance, 50, 'only the invoice total is taken');

    await setOpeningBalances({ asOf: '2020-01-01', accounts: {} });
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const tb = await trialBalance(tomorrow);
    const line = (tb.rows || []).find((r) => r.code === '2170');
    assert(line, '2170 appears on the trial balance: ' + JSON.stringify(Object.keys(tb)));
    const owed = Math.abs(Math.round(Number(line.balance) * 100) / 100);
    equal(owed, await storeCreditOutstanding(), '2170 == the sum of every credit balance');
    equal(Math.round((tb.outOfBalance || 0) * 100) / 100, 0, 'and the books still balance');
  } finally { /* shared: left installed for the next file */ }
});

// Bank details and the payout ledger: encryption, the cooling-off, the append-only
// ledger, settlement arithmetic and the proposal/approval flow — against a real database.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { encryptSecret, decryptSecret, secretsConfigured } from '../lib/secret-box.js';
import { createApplication, setCommission, issueStrike } from '../lib/vendors.js';
import { decideApplication } from './approved-vendor.mjs';
import {
  validateBank, nameLooksRight, submitBankAccount, verifyBankAccount, rejectBankAccount, payableAccount,
  bankSummary, pendingBankAccounts, revealAccount
} from '../lib/vendor-bank.js';
import {
  recordOrderSettlement, recordDeduction, adjust, vendorBalance, vendorStatement, releaseWarrantyReserves
} from '../lib/vendor-ledger.js';
import {
  proposePayouts, proposeForVendor, approvePayout, cancelPayout, markPayoutPaid, markPayoutFailed,
  clearFirstPayout, payoutFile, listPayouts
} from '../lib/payouts.js';

process.env.BANK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

const DAY = 24 * 3600 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const bank = (o = {}) => ({ holderName: 'Alpha Appliances Ltd', institution: '004', transit: '12345', account: '1234567', ...o });

async function vendor(name, { tier = 0 } = {}) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase().replace(/\W/g, '')}@example.com` });
  await decideApplication(v.id, { approve: true, by: 'staff', hstStatus: 'registered' });
  if (tier) await query('UPDATE vendors SET tier = $2 WHERE id = $1', [v.id, tier]);
  return v;
}
// A vendor who can be paid: a verified, cooled bank account and a cleared first payout.
async function payable(name, opts) {
  const v = await vendor(name, opts);
  const s = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'owner@example.com' }, bank({ holderName: name }));
  await verifyBankAccount(s.id, { by: 'admin', how: 'void_cheque', nameMatched: true });
  await clearFirstPayout(v.id, { by: 'admin' });
  return { ...v, bankId: s.id };
}
// A delivered sale that is already past its hold.
const sale = (vendorId, ref, itemCents = 100000, extra = {}) =>
  recordOrderSettlement(vendorId, ref, { itemCents, deliveredAt: daysAgo(30), orderedOn: daysAgo(35).toISOString().slice(0, 10), ...extra });

// ---------------------------------------------------------------------------
suite('secret box — an account number is never stored readable');

test('round-trips, and a ciphertext moved to another vendor will not decrypt', () => {
  assert(secretsConfigured(), 'key set for the test');
  const t = encryptSecret('1234567', 'bank:1');
  assert(!t.includes('1234567'), 'ciphertext does not contain the number');
  equal(decryptSecret(t, 'bank:1'), '1234567');
  let err; try { decryptSecret(t, 'bank:2'); } catch (e) { err = e; }
  assert(err, 'bound to its owner');
});

test('with no key configured it refuses rather than storing in the clear', () => {
  const saved = process.env.BANK_ENCRYPTION_KEY;
  delete process.env.BANK_ENCRYPTION_KEY;
  let err; try { encryptSecret('1234567', 'bank:1'); } catch (e) { err = e; }
  process.env.BANK_ENCRYPTION_KEY = saved;
  assert(err && /BANK_ENCRYPTION_KEY/.test(err.message), 'fails closed');
});

test('Canadian bank numbers are validated and the holder name has a sanity hint', () => {
  equal(validateBank(bank({ institution: ' 004 ', account: '12-34 567' })).account, '1234567');
  for (const bad of [{ institution: '04' }, { transit: '1234' }, { account: '123' }, { holderName: '' }]) {
    let err; try { validateBank(bank(bad)); } catch (e) { err = e; }
    assert(err, `rejected ${JSON.stringify(bad)}`);
  }
  assert(nameLooksRight('Alpha Appliances', 'Alpha Appliances Ltd.'), 'suffix ignored');
  assert(!nameLooksRight('John Smith', 'Alpha Appliances Ltd.'), 'different name');
});

// ---------------------------------------------------------------------------
suite('bank accounts — who can change them and when they take effect');

test('only the owner can submit; the number is stored encrypted and only the last four are visible', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    await rejects(() => submitBankAccount({ vendorId: v.id, role: 'staff', by: 's@example.com' }, bank()), /owner/);
    await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o@example.com' }, bank());
    const { rows } = await client.query('SELECT account_enc, account_last4 FROM vendor_bank_accounts');
    assert(!rows[0].account_enc.includes('1234567'), 'not in the clear');
    equal(rows[0].account_last4, '4567');
    const summary = JSON.stringify(await bankSummary(v.id));
    assert(!summary.includes('1234567') && summary.includes('4567'), 'summary shows last four only');
  } finally { done(); }
});

test('a pending account is not payable; verifying needs a method and an attested name match', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const s = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank());
    equal(await payableAccount(v.id), null);
    assert((await pendingBankAccounts())[0].nameLooksRight === true, 'hint shown to the reviewer');
    await rejects(() => verifyBankAccount(s.id, { by: 'admin', how: 'void_cheque', nameMatched: false }), /matches/);
    await rejects(() => verifyBankAccount(s.id, { by: 'admin', how: 'gut_feeling', nameMatched: true }), /How was it/);
    await verifyBankAccount(s.id, { by: 'admin', how: 'void_cheque', nameMatched: true });
    equal((await payableAccount(v.id)).id, s.id);                    // the first account has no cooling-off
  } finally { done(); }
});

test('CHANGING an account starts a cooling-off: the OLD account keeps being paid until it ends', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const first = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank());
    await verifyBankAccount(first.id, { by: 'admin', how: 'void_cheque', nameMatched: true });
    const second = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank({ account: '7654321' }));
    await verifyBankAccount(second.id, { by: 'admin', how: 'bank_letter', nameMatched: true });
    equal((await payableAccount(v.id)).id, first.id);                // new one is verified but cooling
    const sum = await bankSummary(v.id);
    equal(sum.payable.id, first.id); equal(sum.waiting.length, 1);
    await client.query(`UPDATE vendor_bank_accounts SET cooling_until = now() - interval '1 minute' WHERE id = $1`, [second.id]);
    equal((await payableAccount(v.id)).id, second.id);               // cooling over: the new one is paid
  } finally { done(); }
});

test('a newer submission replaces one still waiting; rejection needs a reason', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const a = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank());
    const b = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank({ account: '9999999' }));
    const { rows } = await client.query('SELECT id, status FROM vendor_bank_accounts ORDER BY id');
    equal(rows.find((r) => r.id === a.id).status, 'rejected');
    await rejects(() => rejectBankAccount(b.id, { by: 'admin' }), /why/);
    await rejectBankAccount(b.id, { by: 'admin', reason: 'name does not match' });
    equal((await pendingBankAccounts()).length, 0);
  } finally { done(); }
});

test('the database refuses a "verified" account that nobody verified', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const s = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank());
    let err; try { await client.query(`UPDATE vendor_bank_accounts SET status='verified' WHERE id = $1`, [s.id]); } catch (e) { err = e; }
    assert(err, 'constraint');
  } finally { done(); }
});

test('revealing a full number needs a reason and is logged', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await payable('Alpha');
    await rejects(() => revealAccount(v.bankId, { by: 'admin' }), /why/);
    equal((await revealAccount(v.bankId, { by: 'admin', reason: 'payout file' })).account, '1234567');
    const { rows } = await client.query(`SELECT event FROM vendor_events WHERE vendor_id = $1 AND event = 'bank_revealed'`, [v.id]);
    equal(rows.length, 1);
  } finally { done(); }
});

// ---------------------------------------------------------------------------
suite('e-transfer payout method — the same safety path as a bank account');

test('validates the address, hides it from the vendor view, and needs an e-transfer test to verify', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const et = (o = {}) => ({ method: 'etransfer', holderName: 'Alpha Appliances Ltd', etransferEmail: 'Pay@Alpha.CA', ...o });
    await rejects(() => submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, et({ etransferEmail: 'nope' })), /email/i);
    await rejects(() => submitBankAccount({ vendorId: v.id, role: 'staff', by: 's' }, et()), /owner/);
    const s = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, et());
    equal(await payableAccount(v.id), null);                                   // nothing pays until verified
    const pending = (await pendingBankAccounts())[0];
    equal(pending.method, 'etransfer'); equal(pending.etransferEmail, 'pay@alpha.ca');
    const seen = JSON.stringify(await bankSummary(v.id));
    assert(!seen.includes('pay@alpha.ca'), 'the full address is not in the vendor view');
    assert(seen.includes('p•••@alpha.ca'), 'it is masked');
    await rejects(() => verifyBankAccount(s.id, { by: 'admin', how: 'void_cheque', nameMatched: true }), /e-transfer test/);
    await rejects(() => verifyBankAccount(s.id, { by: 'admin', how: 'etransfer_test', nameMatched: false }), /matches/);
    await verifyBankAccount(s.id, { by: 'admin', how: 'etransfer_test', nameMatched: true });
    equal((await payableAccount(v.id)).id, s.id);
    const { rows } = await client.query('SELECT institution, account_enc FROM vendor_bank_accounts WHERE id = $1', [s.id]);
    equal(rows[0].institution, null); equal(rows[0].account_enc, null);
    // and a bank account cannot be "verified" by an e-transfer test
    const b = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, bank());
    await rejects(() => verifyBankAccount(b.id, { by: 'admin', how: 'etransfer_test', nameMatched: true }), /only verifies an e-transfer/);
  } finally { done(); }
});

test('replacing a verified bank account with an e-transfer address starts the cooling-off', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha');
    const s = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, { method: 'etransfer', holderName: 'Alpha', etransferEmail: 'pay@alpha.ca' });
    await verifyBankAccount(s.id, { by: 'admin', how: 'etransfer_test', nameMatched: true });
    equal((await payableAccount(v.id)).id, v.bankId);                           // the old account is still the payable one
  } finally { done(); }
});

test('a vendor paid by e-transfer is proposed, approved, and appears in the payout file with the address', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const s = await submitBankAccount({ vendorId: v.id, role: 'owner', by: 'o' }, { method: 'etransfer', holderName: 'Alpha', etransferEmail: 'pay@alpha.ca' });
    await verifyBankAccount(s.id, { by: 'admin', how: 'etransfer_test', nameMatched: true });
    await clearFirstPayout(v.id, { by: 'admin' });
    await sale(v.id, 'BB-ET', 100000);
    const run = await proposePayouts({ by: 'system' });
    equal(run.proposed.length, 1);
    const id = run.proposed[0].payoutId;
    await approvePayout(id, { by: 'admin' });
    const file = await payoutFile([id], { by: 'admin' });
    const lines = file.csv.trim().split('\n');
    assert(/etransfer_email/.test(lines[0]), 'header names the column');
    assert(lines[1].includes('etransfer') && lines[1].includes('pay@alpha.ca'), 'the row carries the address');
  } finally { done(); }
});

// ---------------------------------------------------------------------------
suite('the ledger — append-only, derived, idempotent');

test('a settled order books the sale, commission, fees and the 2% hold — and nets to the breakdown', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const r = await sale(v.id, 'BB-1', 100000, { deliveryServiceCents: 5900, insuranceCents: 1500 });
    equal(r.breakdown.commission, 10000);
    const bal = await vendorBalance(v.id);
    equal(bal.availableCents, r.breakdown.payable);
    equal(bal.reserveHeldCents, r.breakdown.reserve);
    equal(bal.availableCents, 100000 - 10000 - 5900 - 1500 - r.breakdown.reserve - r.breakdown.hstOnFeesCents);
  } finally { done(); }
});

test('settling the same order twice writes nothing the second time', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const a = await sale(v.id, 'BB-1'); const b = await sale(v.id, 'BB-1');
    equal(a.alreadyBooked, false); equal(b.alreadyBooked, true);
    equal((await vendorStatement(v.id)).length, 4);                  // sale, commission, warranty hold, HST on our commission
  } finally { done(); }
});

test('the sale is PENDING until delivery plus the tier\'s hold, then becomes available', async () => {
  const { done } = await withTestDb();
  try {
    const p = await vendor('Probation', { tier: 0 });                // 14 days
    const t = await vendor('Trusted', { tier: 2 });                  //  3 days
    for (const v of [p, t]) await recordOrderSettlement(v.id, 'BB-9', { itemCents: 100000, deliveredAt: daysAgo(5) });
    equal((await vendorBalance(p.id)).availableCents, 0);
    assert((await vendorBalance(p.id)).pendingCents > 0, 'probation still pending');
    assert((await vendorBalance(t.id)).availableCents > 0, 'trusted already available');
  } finally { done(); }
});

test('the commission in force on the ORDER date applies — a later raise does not touch it', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    await setCommission({ vendorId: v.id, rateBps: 1500, effectiveFrom: '2099-01-01', by: 'admin' });
    const early = await recordOrderSettlement(v.id, 'BB-1', { itemCents: 100000, deliveredAt: daysAgo(30), orderedOn: '2026-10-01' });
    const late = await recordOrderSettlement(v.id, 'BB-2', { itemCents: 100000, deliveredAt: daysAgo(30), orderedOn: '2099-02-01' });
    equal(early.breakdown.commission, 10000); equal(late.breakdown.commission, 15000);
  } finally { done(); }
});

test('Lane C: the vendor\'s share of the delivery fee is added and no service fee is charged', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const r = await sale(v.id, 'BB-C', 50000, { laneCDeliveryCents: 6320 });
    equal(r.breakdown.netBeforeReserve, 50000 + 6320 - 5000);
  } finally { done(); }
});

test('THE LEDGER CANNOT BE EDITED OR DELETED, and each kind keeps its sign', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); await sale(v.id, 'BB-1');
    let e1; try { await client.query('UPDATE vendor_ledger SET amount_cents = 1'); } catch (e) { e1 = e; }
    let e2; try { await client.query('DELETE FROM vendor_ledger'); } catch (e) { e2 = e; }
    assert(e1 && /append-only/.test(e1.message), 'update refused');
    assert(e2 && /append-only/.test(e2.message), 'delete refused');
    let e3; try { await client.query(`INSERT INTO vendor_ledger (vendor_id, kind, amount_cents) VALUES ($1,'commission',500)`, [v.id]); } catch (e) { e3 = e; }
    assert(e3, 'a commission cannot be a credit');
  } finally { done(); }
});

test('refunds and chargebacks come straight off; an adjustment needs a reason and a name', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); await sale(v.id, 'BB-1');
    const before = (await vendorBalance(v.id)).availableCents;
    await recordDeduction(v.id, { kind: 'refund', amountCents: 20000, orderRef: 'BB-1', by: 'admin', idemKey: 'refund:BB-1' });
    equal((await recordDeduction(v.id, { kind: 'refund', amountCents: 20000, orderRef: 'BB-1', by: 'admin', idemKey: 'refund:BB-1' })).duplicate, true);
    equal((await vendorBalance(v.id)).availableCents, before - 20000);
    await rejects(() => adjust(v.id, { amountCents: 500, by: 'admin' }), /reason/);
    await rejects(() => adjust(v.id, { amountCents: 500, memo: 'goodwill' }), /Who/);
    await adjust(v.id, { amountCents: -500, memo: 'late fee waived back', by: 'admin' });
    equal((await vendorBalance(v.id)).availableCents, before - 20500);
  } finally { done(); }
});

test('warranty reserves are released after twelve months, unless a claim is open', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    await recordOrderSettlement(v.id, 'BB-OLD', { itemCents: 100000, deliveredAt: daysAgo(500) });
    await recordOrderSettlement(v.id, 'BB-NEW', { itemCents: 100000, deliveredAt: daysAgo(30) });
    const held = (await vendorBalance(v.id)).reserveHeldCents;
    const r = await releaseWarrantyReserves({ blocked: new Set(['BB-OLD']) });
    equal(r.released, 0);                                            // the old one is blocked by a claim
    const r2 = await releaseWarrantyReserves();
    equal(r2.released, 1);
    assert((await vendorBalance(v.id)).reserveHeldCents < held, 'reserve shrank');
    equal((await releaseWarrantyReserves()).released, 0);            // and cannot be released twice
    void client;
  } finally { done(); }
});

// ---------------------------------------------------------------------------
suite('payouts — proposed, approved, paid');

test('the weekly run proposes for approved, cleared, banked vendors and says why it skipped the rest', async () => {
  const { done } = await withTestDb();
  try {
    const ok = await payable('Alpha'); await sale(ok.id, 'BB-1');
    const nobank = await vendor('NoBank'); await sale(nobank.id, 'BB-2');
    const small = await payable('Small'); await sale(small.id, 'BB-3', 3000);
    const uncleared = await vendor('Uncleared');
    const s = await submitBankAccount({ vendorId: uncleared.id, role: 'owner', by: 'o' }, bank());
    await verifyBankAccount(s.id, { by: 'admin', how: 'void_cheque', nameMatched: true });
    await sale(uncleared.id, 'BB-4');
    const r = await proposePayouts();
    equal(r.proposed.length, 1); equal(r.proposed[0].vendorId, ok.id);
    const why = Object.fromEntries(r.skipped.map((x) => [x.vendor, x.reason]));
    assert(/bank account/.test(why.NoBank), why.NoBank);
    assert(/minimum/.test(why.Small), why.Small);
    assert(/first payout/.test(why.Uncleared), why.Uncleared);
  } finally { done(); }
});

test('approval debits the ledger, and a second run does not propose again while one is open', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha'); await sale(v.id, 'BB-1');
    const { proposed } = await proposePayouts();
    equal((await proposePayouts()).proposed.length, 0);
    const avail = (await vendorBalance(v.id)).availableCents;
    equal((await approvePayout(proposed[0].payoutId, { by: 'admin' })).ok, true);
    equal((await vendorBalance(v.id)).availableCents, avail - proposed[0].amountCents);
    await rejects(() => approvePayout(proposed[0].payoutId, { by: 'admin' }), /already/);
    await markPayoutPaid(proposed[0].payoutId, { by: 'admin', ref: 'EFT-1' });
    equal((await vendorBalance(v.id)).paidOutCents, proposed[0].amountCents);
  } finally { done(); }
});

test('a refund that lands between proposal and approval cancels the proposal rather than overpaying', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha'); await sale(v.id, 'BB-1');
    const { proposed } = await proposePayouts();
    await recordDeduction(v.id, { kind: 'chargeback', amountCents: 50000, orderRef: 'BB-1', by: 'admin' });
    const r = await approvePayout(proposed[0].payoutId, { by: 'admin' });
    equal(r.ok, false); equal(r.cancelled, true);
    equal((await listPayouts({ status: 'cancelled' })).length, 1);
  } finally { done(); }
});

test('over $2,000 the approver must not be the person who proposed it; the system\'s own proposals are fine', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha'); await sale(v.id, 'BB-1', 500000);
    const { id } = await proposeForVendor(v.id, { by: 'ana@example.com' });
    await rejects(() => approvePayout(id, { by: 'ana@example.com' }), /second person/);
    equal((await approvePayout(id, { by: 'ben@example.com' })).ok, true);
    const w = await payable('Bravo'); await sale(w.id, 'BB-2', 500000);
    const sys = (await proposePayouts()).proposed.find((p) => p.vendorId === w.id);
    equal((await approvePayout(sys.payoutId, { by: 'ana@example.com' })).ok, true);
  } finally { done(); }
});

test('a failed payout is a visible reversal and the money is available again', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha'); await sale(v.id, 'BB-1');
    const { proposed } = await proposePayouts();
    const before = (await vendorBalance(v.id)).availableCents;
    await approvePayout(proposed[0].payoutId, { by: 'admin' });
    await rejects(() => markPayoutFailed(proposed[0].payoutId, { by: 'admin' }), /what went wrong/);
    await markPayoutFailed(proposed[0].payoutId, { by: 'admin', note: 'account closed' });
    equal((await vendorBalance(v.id)).availableCents, before);
    assert((await vendorStatement(v.id)).some((e) => e.kind === 'payout_reversal'), 'reversal on the record');
  } finally { done(); }
});

test('restricted vendors are skipped by the run but an admin can still pay what they are owed', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha'); await sale(v.id, 'BB-1');
    for (const reason of ['missed_accept', 'missed_ready', 'cancelled_order']) await issueStrike(v.id, { reason, by: 'system' });
    const r = await proposePayouts();
    equal(r.proposed.length, 0);
    assert(r.skipped.some((x) => /restricted/.test(x.reason)), 'said why');
    const manual = await proposeForVendor(v.id, { by: 'admin' });
    assert(manual.ok, 'manual proposal allowed');
  } finally { done(); }
});

test('the bank file carries the full number and logs it; unapproved payouts are not in it; cells cannot be formulas', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await payable('=Alpha Appliances'); await sale(v.id, 'BB-1');
    const { proposed } = await proposePayouts();
    await rejects(() => payoutFile([proposed[0].payoutId], { by: 'admin' }), /approved/);
    await approvePayout(proposed[0].payoutId, { by: 'admin' });
    const { csv, count } = await payoutFile([proposed[0].payoutId], { by: 'admin' });
    equal(count, 1);
    assert(csv.includes('1234567'), 'full account in the file');
    assert(csv.includes("'=Alpha"), 'leading = neutralised');
    const { rows } = await client.query(`SELECT 1 FROM vendor_events WHERE event = 'bank_revealed' AND vendor_id = $1`, [v.id]);
    equal(rows.length, 1);
  } finally { done(); }
});

test('cancelling a proposal frees the vendor for the next run', async () => {
  const { done } = await withTestDb();
  try {
    const v = await payable('Alpha'); await sale(v.id, 'BB-1');
    const { proposed } = await proposePayouts();
    await cancelPayout(proposed[0].payoutId, { by: 'admin', note: 'hold on' });
    equal((await proposePayouts()).proposed.length, 1);
  } finally { done(); }
});

test('MONTHLY STATEMENT: opening + the month\'s entries = closing, Toronto-time months, CSV cannot carry a formula', async () => {
  const { done } = await withTestDb();
  try {
    const { monthlyStatement, statementCsv } = await import('../lib/vendor-ledger.js');
    const v = await createApplication({ legalName: 'Stmt', contactEmail: 'stmt@example.com' });
    await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
    const ins = (kind, cents, at, memo = null) => query(
      `INSERT INTO vendor_ledger (vendor_id, kind, amount_cents, order_ref, memo, at, available_at) VALUES ($1,$2,$3,'BB-1',$4,$5,$5)`, [v.id, kind, cents, memo, at]);
    await ins('sale', 100000, '2026-09-30T12:00:00Z');                                  // before October: the opening balance
    await ins('commission', -10000, '2026-10-02T15:00:00Z', '=HYPERLINK("x")');          // a memo that would be a formula
    await ins('sale', 50000, '2026-11-01T03:30:00Z');                                    // 23:30 on Oct 31 in Toronto: still October
    await ins('sale', 70000, '2026-11-05T12:00:00Z');                                    // November: not in this statement
    const st = await monthlyStatement(v.id, '2026-10');
    equal(st.openingCents, 100000); equal(st.entries.length, 2); equal(st.closingCents, 140000);
    equal(st.closingCents, st.openingCents + st.entries.reduce((a, e) => a + e.amountCents, 0));
    const csv = statementCsv(st);
    assert(/'=HYPERLINK/.test(csv) && !/,=HYPERLINK/.test(csv), 'formula neutralised');
    assert(/Closing balance,,,,1400\.00/.test(csv.replace(/\r/g, '')) || /1400\.00/.test(csv), 'closing in the file');
    await rejects(() => monthlyStatement(v.id, 'October'), /month like/);
  } finally { done(); }
});

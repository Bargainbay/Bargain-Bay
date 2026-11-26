// A payment a PERSON enters goes through the same check the Manager follows (2026-11-17, after INV-1410):
// every e-transfer entry is backed by a bank email nothing else has used, and a SECOND payment of the same amount
// needs a SECOND e-transfer. Real lib code, real Postgres (PGlite); the bank mailbox is a test seam.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { withPaymentCheck, vetEtransfer, unbackedEtransfers, __useTestBankEmails, PaymentCheckError, scanPayments, clearFlagged, etransferBacking } from '../lib/manager-payments.js';
import { recordInvoicePayment, markInvoicePaid, voidInvoicePayment } from '../lib/invoices.js';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

async function withDb(fn) {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  try { await fn(client); } finally { __useTestDatabase(null); __useTestBankEmails(null); }
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const em = (id, cents, name, plusMs = 0) => ({ id, p: { amountCents: cents, name, at: new Date(Date.now() + plusMs).toISOString() } });
async function invoice(client, number, name, total) {
  const { rows } = await client.query(`INSERT INTO invoices (number, email, name, total, status, channel) VALUES ($1,$2,$3,$4,'open','manual') RETURNING id`, [number, 'x@example.com', name, total]);
  return rows[0].id;
}
const enter = (id, amount, opts = {}) => withPaymentCheck(id, {
  method: 'etransfer', amount, paidDate: today(), ...opts,
  apply: () => recordInvoicePayment(id, { amount, method: 'etransfer', paidDate: today(), silent: true })
});
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const count = async (client, id) => Number((await client.query('SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1', [id])).rows[0].n);

suite('payment check: a second payment needs a second e-transfer');
test('INV-1410 by hand: the same $275 entered twice with ONE bank email is refused, and nothing is recorded', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu')]);
    const id = await invoice(client, 'INV-C1', 'Joyce Zhu', 550);
    const first = await enter(id, 275);
    equal(first.check.verified, true);
    const err = await refused(() => enter(id, 275));
    assert(err instanceof PaymentCheckError, 'the second entry is refused');
    assert(/second e-transfer/.test(err.message), err.message);
    equal(await count(client, id), 1);
  });
});
test('a genuine second e-transfer (a second bank email) lets the second entry through, then a third is refused', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu'), em('b', 27500, 'Joyce Zhu', 3600_000)]);
    const id = await invoice(client, 'INV-C2', 'Joyce Zhu', 825);
    await enter(id, 275);
    const second = await enter(id, 275);
    equal(second.check.verified, true);
    equal(await count(client, id), 2);
    assert(await refused(() => enter(id, 275)), 'a third needs a third e-transfer');
    equal(await count(client, id), 2);
  });
});
test('one bank email cannot back payments on two different invoices', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Pat Lee')]);
    const a = await invoice(client, 'INV-C3', 'Pat Lee', 275);
    const b = await invoice(client, 'INV-C4', 'Pat Lee', 275);
    await enter(a, 275);
    const err = await refused(() => enter(b, 275));
    assert(err instanceof PaymentCheckError && /already on the ledger/.test(err.message), err?.message);
    equal(await count(client, b), 0);
  });
});
test('two customers who each paid $275 on the same day are both fine: two emails, two entries', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Pat Lee'), em('b', 27500, 'Sam Wu', 1000)]);
    const a = await invoice(client, 'INV-C5', 'Pat Lee', 275);
    const b = await invoice(client, 'INV-C6', 'Sam Wu', 275);
    equal((await enter(a, 275)).check.from, 'Pat Lee');   // the email whose name agrees is the one used
    equal((await enter(b, 275)).check.from, 'Sam Wu');
  });
});

suite('payment check: other mistakes are let through with a warning that stays on the payment');
test('no bank email at all: recorded, but warned and stamped NOT verified, and listed for the Manager', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([]);
    const id = await invoice(client, 'INV-C7', 'Pat Lee', 500);
    const r = await enter(id, 200);
    equal(r.check.verified, false);
    assert(r.check.warnings.some((w) => /NOT verified/.test(w)));
    const note = (await client.query('SELECT note FROM invoice_payments WHERE invoice_id = $1', [id])).rows[0].note;
    assert(/NOT verified/.test(note), note);
    const list = await unbackedEtransfers();
    equal(list.entries.length, 1); equal(list.entries[0].invoice, 'INV-C7');
  });
});
test('a typo\'d amount: a bank email from the same person for a different amount is pointed out', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu')]);
    const id = await invoice(client, 'INV-C8', 'Joyce Zhu', 550);
    const r = await enter(id, 257);
    equal(r.check.verified, false);
    assert(r.check.warnings.some((w) => /\$275\.00/.test(w)), r.check.warnings.join(' | '));
  });
});
test('the e-transfer is from a different name than the invoice: recorded with a warning, not refused', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Someone Else')]);
    const id = await invoice(client, 'INV-C9', 'Joyce Zhu', 275);
    const r = await enter(id, 275);
    equal(r.check.verified, true);
    assert(r.check.warnings.some((w) => /Someone Else/.test(w) && /Joyce Zhu/.test(w)), r.check.warnings.join(' | '));
  });
});
test('mailbox unreadable: a first entry goes through unverified; a repeat of the same amount on the same invoice is still refused', async () => {
  await withDb(async (client) => {
    __useTestBankEmails(null);   // gmail is not configured in tests
    const id = await invoice(client, 'INV-C10', 'Pat Lee', 550);
    const first = await enter(id, 275);
    equal(first.check.verified, false);
    assert(first.check.warnings.some((w) => /bank emails/.test(w)));
    const err = await refused(() => enter(id, 275));
    assert(err instanceof PaymentCheckError, 'the repeat is refused even though the mailbox cannot be read');
  });
});
test('cash, cheque and card are not checked at all', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([]);
    const id = await invoice(client, 'INV-C11', 'Pat Lee', 550);
    for (let i = 0; i < 2; i++) await withPaymentCheck(id, { method: 'cash', amount: 100, apply: () => recordInvoicePayment(id, { amount: 100, method: 'cash', silent: true }) });
    equal(await count(client, id), 2);
  });
});

suite('payment check: the owner can override a double, with a reason on the record');
test('a blocked double: staff cannot override; an admin needs a real reason, and it is written on the payment', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu')]);
    const id = await invoice(client, 'INV-C12', 'Joyce Zhu', 550);
    await enter(id, 275);
    const staff = await refused(() => enter(id, 275, { isAdmin: false, overrideReason: 'please' }));
    assert(staff instanceof PaymentCheckError && staff.canOverride === false, 'a rep cannot override');
    const noReason = await refused(() => enter(id, 275, { isAdmin: true, overrideReason: 'x' }));
    assert(noReason instanceof PaymentCheckError && noReason.canOverride === true, 'an admin is offered it, but needs a reason');
    const ok = await enter(id, 275, { isAdmin: true, overrideReason: 'Paid by her sister from a second account', by: 'Owner' });
    equal(ok.check.overridden, true);
    const notes = (await client.query('SELECT note FROM invoice_payments WHERE invoice_id = $1 ORDER BY id', [id])).rows.map((r) => r.note);
    assert(/overridden by Owner: Paid by her sister/.test(notes[1]), notes[1]);
  });
});

suite('payment check: it cannot leave a bank email stuck or half-used');
test('if recording the payment fails, the bank email is given back', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu')]);
    const id = await invoice(client, 'INV-C13', 'Joyce Zhu', 550);
    const err = await refused(() => withPaymentCheck(id, { method: 'etransfer', amount: 275, paidDate: today(), apply: async () => { throw new Error('ledger down'); } }));
    equal(err.message, 'ledger down');
    const ok = await enter(id, 275);
    equal(ok.check.verified, true);
  });
});
test('removing an entry gives its bank email back, so a corrected entry can use it', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu')]);
    const id = await invoice(client, 'INV-C14', 'Joyce Zhu', 550);
    await enter(id, 275);
    const pid = (await client.query('SELECT id FROM invoice_payments WHERE invoice_id = $1', [id])).rows[0].id;
    await voidInvoicePayment(id, pid);
    const again = await enter(id, 275);
    equal(again.check.verified, true);
  });
});
test('paying the whole balance by e-transfer (mark paid) is checked on the balance, and stamped', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('a', 27500, 'Joyce Zhu')]);
    const id = await invoice(client, 'INV-C15', 'Joyce Zhu', 550);
    await enter(id, 275);
    // 'Mark paid' with nothing typed means the remaining $275, which is the same amount again: refused.
    const err = await refused(() => withPaymentCheck(id, { method: 'etransfer', paidDate: today(), apply: () => markInvoicePaid(id, 'etransfer', today()) }));
    assert(err instanceof PaymentCheckError, 'the closing $275 needs its own e-transfer');
    equal((await client.query('SELECT status FROM invoices WHERE id = $1', [id])).rows[0].status, 'partial');
  });
});
test('vetEtransfer never throws for an unknown invoice', async () => {
  await withDb(async () => {
    const v = await vetEtransfer(999999, { amount: 10 });
    equal(v.ok, true);
  });
});

suite('payment check: a flagged e-transfer stops being reported once it is dealt with');
const flag = (client, msg, cents, name, daysAgo = 0) => client.query(
  `INSERT INTO manager_payments (msg_id, sender, amount_cents, received_at, status) VALUES ($1,$2,$3, now() - ($4::int * interval '1 day'),'flag_unmatched')`, [msg, name, cents, daysAgo]);
const openFlags = async (client) => Number((await client.query(`SELECT count(*)::int AS n FROM manager_payments WHERE resolved_at IS NULL AND status LIKE 'flag%'`)).rows[0].n);

test('a flag raised before staff entered the payment closes on the next scan, even once its email has aged out', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([]);
    const id = await invoice(client, 'INV-C20', 'Pat Lee', 300);
    await recordInvoicePayment(id, { amount: 300, method: 'etransfer', paidDate: today(), silent: true });
    await scanPayments({ dry: true });
    await flag(client, 'old', 30000, 'Pat Lee');
    await scanPayments();
    equal(await openFlags(client), 0);
  });
});
test('clearing on the owner\'s word closes every flag, changes no money, and keeps each email used up', async () => {
  await withDb(async (client) => {
    __useTestBankEmails([em('x', 41000, 'Sam Wu')]);
    await scanPayments({ dry: true });
    const id = await invoice(client, 'INV-C21', 'Sam Wu', 410);
    await flag(client, 'x', 41000, 'Sam Wu');
    await flag(client, 'y', 9900, 'Nobody', 20);
    const r = await clearFlagged({ by: 'owner@example.com' });
    equal(r.cleared, 2);
    equal(r.stillOwing.length, 1); equal(r.stillOwing[0].invoice, 'INV-C21');
    equal(await openFlags(client), 0);
    equal(await count(client, id), 0);
    equal((await etransferBacking(410)).ok, false);
  });
});

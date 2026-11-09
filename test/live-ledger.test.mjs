// The live transaction list: pending and incoming bank lines, who money came from, and a descriptive cash sale.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertExpense } from '../lib/finance.js';
import { mapActivity, recordActivity, deleteActivity, sortIncome, splitActivity, hasExpense } from '../lib/bank-activity.js';
import { parseInteracReceived, nameTransfersFromEmail, matchTransfers } from '../lib/interac-names.js';
import { bankrollSummary } from '../lib/bankroll.js';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

suite('live ledger');

test('mapActivity FLIPS PLAID\'S SIGN SO MONEY IN IS POSITIVE AND KEEPS PENDING', () => {
  const a = mapActivity({ transaction_id: 'p1', date: '2026-11-08', amount: -600, pending: true, name: 'E-TRANSFER ***hCA', original_description: 'E-TRANSFER ***hCA', payment_meta: { reason: 'INV 1359' } });
  equal(a.amount, 600); assert(a.pending); equal(a.extId, 'plaid:p1'); equal(a.memo, 'INV 1359');
  equal(mapActivity({ transaction_id: 'p2', date: '2026-11-08', amount: 80 }).amount, -80);
  assert(mapActivity({ transaction_id: 'p3', date: '2026-11-08', amount: 0 }) === null);
});

test('parseInteracReceived READS WHO SENT IT AND HOW MUCH', () => {
  const r = parseInteracReceived({ subject: "Interac e-Transfer: You've received $600.00 from JOAN GRANT and it has been automatically deposited.", internalDate: 1000 });
  equal(r.amountCents, 60000); equal(r.name, 'JOAN GRANT');
  assert(parseInteracReceived({ subject: 'Interac e-Transfer: Your $5.00 transfer to X has been successfully deposited.' }) === null);
});

test('INCOMING WINDOW: THE EMAIL IS THE SAME DAY OR A LITTLE BEFORE THE LINE POSTS', () => {
  const t = Date.parse('2026-11-08T12:00:00Z');
  const lines = [{ id: 1, grossCents: 60000, date: '2026-11-08' }];
  equal(matchTransfers([{ id: 'e', amountCents: 60000, name: 'A', at: t - 86400e3 }], lines, { before: 3, after: 1.5 }).length, 1);
  equal(matchTransfers([{ id: 'e', amountCents: 60000, name: 'A', at: t + 5 * 86400e3 }], lines, { before: 3, after: 1.5 }).length, 0);
});

test('AN INCOMING E-TRANSFER GETS THE SENDER\'S NAME FROM INTERAC AND NEVER ON AN AMBIGUOUS PAIR', async () => {
  const { done } = await withTestDb();
  try {
    await recordActivity(mapActivity({ transaction_id: 'in1', date: today(), amount: -600, name: 'E-TRANSFER ***hCA', original_description: 'E-TRANSFER ***hCA' }));
    await recordActivity(mapActivity({ transaction_id: 'in2', date: today(), amount: -75, name: 'E-TRANSFER ***aaa' }));
    await recordActivity(mapActivity({ transaction_id: 'in3', date: today(), amount: -75, name: 'E-TRANSFER ***bbb' }));
    const now = Date.now();
    const r = await nameTransfersFromEmail({
      emailsFn: async () => [], emailsInFn: async () => [
        { id: 'm1', subject: "Interac e-Transfer: You've received $600.00 from JOAN GRANT and it has been automatically deposited.", internalDate: now },
        { id: 'm2', subject: "Interac e-Transfer: You've received $75.00 from SOMEONE and it has been automatically deposited.", internalDate: now }] });
    equal(r.namedIn, 1, 'the unique $600 is named; two $75 lines for one email are not guessed');
    const rows = (await query(`SELECT ext_id, who_override FROM bank_activity ORDER BY ext_id`)).rows;
    equal(rows.find((x) => x.ext_id === 'plaid:in1').who_override, 'JOAN GRANT');
    assert(!rows.find((x) => x.ext_id === 'plaid:in2').who_override);
  } finally { done(); }
});

test('THE LIVE LIST SHOWS PENDING AND INCOMING LINES, WHO FROM, AND A CASH SALE WITH ITS INVOICE AND CUSTOMER', async () => {
  const { done } = await withTestDb();
  try {
    const d = today();
    await recordActivity(mapActivity({ transaction_id: 'pe1', date: d, amount: 300, pending: true, name: 'SEND E-TFR *xyz', original_description: 'SEND E-TFR *xyz MEMO' }));
    await recordActivity(mapActivity({ transaction_id: 'in9', date: d, amount: -450, name: 'E-TRANSFER ***q' }));
    await query(`UPDATE bank_activity SET who_override = 'DITA RAJI CORPORATION' WHERE ext_id = 'plaid:in9'`);
    await upsertExpense({ incurredOn: d, category: 'Other', vendor: 'SEND E-TFR', amount: 120, tax: null, note: 'TD', extId: 'plaid:x', source: 'plaid',
      payee: null, bankDesc: 'SEND E-TFR *nMU EXP', memo: 'for fuel' });
    await query(`UPDATE expenses SET user_note = 'Ravi, fuel run', payee_override = 'RAVI' WHERE ext_id = 'plaid:x'`);
    const { rows: inv } = await query(`INSERT INTO invoices (email, name, status, subtotal, hst, total, memo, channel) VALUES ('j@x.ca','Joan Grant','paid',531.86,69.14,601,'Balance on fridge','manual') RETURNING id`);
    await query(`UPDATE invoices SET number = 'INV-1359' WHERE id = $1`, [inv[0].id]);
    await query(`INSERT INTO invoice_payments (invoice_id, amount, method) VALUES ($1, 601, 'cash')`, [inv[0].id]);

    const s = await bankrollSummary(d, { days: 1 });
    const by = (tag) => s.live.filter((l) => l.tag === tag);
    assert(by('Pending out').length === 1 && by('Pending out')[0].pending, 'a pending line shows today');
    const inc = by('Bank in')[0];
    equal(inc.who, 'DITA RAJI CORPORATION'); assert(inc.detail.fields.some(([k, v]) => k === 'Came from' && v === 'DITA RAJI CORPORATION'));
    const out = by('Bank out')[0];
    equal(out.who, 'RAVI');
    const f = Object.fromEntries(out.detail.fields);
    equal(f['Sent to'], 'RAVI'); equal(f['Our note'], 'Ravi, fuel run'); equal(f['Memo the bank carries'], 'for fuel'); equal(f['Bank description'], 'SEND E-TFR *nMU EXP');
    const sale = by('Cash sale')[0];
    equal(sale.invoice.number, 'INV-1359'); equal(sale.invoice.customer, 'Joan Grant'); assert(/INV-1359 · Joan Grant/.test(sale.who));
    assert(sale.detail.links.some((l) => l.href === '/invoice/INV-1359'), 'a link to open the invoice');
    await deleteActivity('plaid:pe1');
    equal((await bankrollSummary(d, { days: 1 })).live.filter((l) => l.tag === 'Pending out').length, 0, 'a retracted pending line goes away');
  } finally { done(); }
});

test('A TRANSFER THE BANK CALLS A TRANSFER BECOMES AN EXPENSE ONLY WHEN A PERSON SORTS IT, WAGES WITHOUT HST, AND THE BANK RE-SENDING IT CHANGES NOTHING', async () => {
  const { done } = await withTestDb();
  try {
    const { promoteActivity } = await import('../lib/bank-activity.js');
    await recordActivity(mapActivity({ transaction_id: 'tr1', date: '2026-11-06', amount: 720, name: 'SEND E-TFR *tgn SALA', original_description: 'SEND E-TFR *tgn SALA' }));
    await recordActivity(mapActivity({ transaction_id: 'tr2', date: today(), amount: 50, pending: true, name: 'SEND E-TFR *p' }));
    const id = (await query(`SELECT id FROM bank_activity WHERE ext_id = 'plaid:tr1'`)).rows[0].id;
    assert((await bankrollSummary(today(), { days: 30 })).live.some((l) => l.activityId === id), 'a settled transfer offers to be sorted');
    const r = await promoteActivity(id, { category: 'Wages', by: 'a' });
    equal(r.gross, 720);
    const e = (await query(`SELECT * FROM expenses WHERE ext_id = 'plaid:tr1'`)).rows[0];
    equal(e.category, 'Wages'); equal(Number(e.tax), 0); equal(Number(e.amount), 720); assert(e.reviewed_at); equal(e.cat_source, 'manual');
    equal((await query(`SELECT 1 FROM bank_activity WHERE ext_id = 'plaid:tr1'`)).rowCount, 0, 'no longer an activity line');
    const pendingId = (await query(`SELECT id FROM bank_activity WHERE ext_id = 'plaid:tr2'`)).rows[0].id;
    let msg = ''; try { await promoteActivity(pendingId, { category: 'Wages' }); } catch (x) { msg = x.message; }
    assert(/pending/.test(msg), 'a pending line cannot be sorted yet');
  } finally { done(); }
});

test('"BANK SHOWS IT" HANDS THE ENTRY\'S CATEGORY AND NAME TO THE LINE, EVEN A TRANSFER LINE', async () => {
  const { done } = await withTestDb();
  try {
    const { addEntry, clearEntry } = await import('../lib/bankroll.js');
    const eid = await addEntry({ date: '2026-11-08', kind: 'pending', amount: -720, note: 'To Ravi', category: 'Wages', payee: 'Ravi', by: 'a' });
    await recordActivity(mapActivity({ transaction_id: 'tr9', date: '2026-11-09', amount: 720, name: 'SEND E-TFR *x' }));
    const s = await bankrollSummary('2026-11-09');
    const hint = s.entries.find((e) => e.id === eid).bankShows;
    assert(hint && hint.kind === 'activity', 'the transfer line is offered as what the bank now shows');
    await clearEntry(eid, 'a', { kind: hint.kind, id: hint.id });
    const e = (await query(`SELECT * FROM expenses WHERE ext_id = 'plaid:tr9'`)).rows[0];
    equal(e.category, 'Wages'); equal(e.payee_override, 'Ravi'); equal(Number(e.tax), 0);
    equal((await bankrollSummary('2026-11-09')).pending, 0, 'and it stops counting twice');
  } finally { done(); }
});

test('THE PAGE KNOWS THE NEWEST LINE THE BANK HAS SENT, SO A WEEKEND GAP IS SAID OUT LOUD', async () => {
  const { done } = await withTestDb();
  try {
    await recordActivity(mapActivity({ transaction_id: 'n1', date: '2026-11-06', amount: -10, name: 'X' }));
    equal((await bankrollSummary('2026-11-08')).bankNewest, '2026-11-06');
  } finally { done(); }
});

test('MONEY IN CAN BE LABELLED, STAYS OUT OF EXPENSES, AND MONEY OUT CANNOT TAKE AN INCOME LABEL', async () => {
  const { done } = await withTestDb();
  try {
    await recordActivity(mapActivity({ transaction_id: 'inc1', date: today(), amount: -630, name: 'E-TRANSFER ***zz' }));
    await recordActivity(mapActivity({ transaction_id: 'out1', date: today(), amount: 50, name: 'SEND E-TFR *abc' }));
    const inId = (await query(`SELECT id FROM bank_activity WHERE amount > 0`)).rows[0].id;
    const outId = (await query(`SELECT id FROM bank_activity WHERE amount < 0`)).rows[0].id;
    await sortIncome(inId, { category: 'Product sale' });
    const row = (await bankrollSummary(today(), { days: 7 })).live.find((l) => l.incomeId === inId);
    equal(row.incomeCategory, 'Product sale');
    await sortIncome(inId, { category: 'Consulting fee' });
    equal((await bankrollSummary(today(), { days: 7 })).live.find((l) => l.incomeId === inId).incomeCategory, 'Consulting fee', 'free text is kept');
    equal((await query(`SELECT count(*)::int AS n FROM expenses`)).rows[0].n, 0, 'income never becomes an expense');
    let threw = false; try { await sortIncome(outId, { category: 'Customer payment' }); } catch { threw = true; }
    assert(threw, 'money out is refused');
    threw = false; try { await sortIncome(inId, { category: 'x'.repeat(61) }); } catch { threw = true; }
    assert(threw, 'an over-long label is refused');
  } finally { await done(); }
});

test('ONE TRANSFER SPLIT INTO TWO CATEGORIES: PARTS MUST ADD UP, EACH BECOMES AN EXPENSE, AND THE BANK RE-SENDING IT ADDS NOTHING', async () => {
  const { done } = await withTestDb();
  try {
    await recordActivity(mapActivity({ transaction_id: 'sp1', date: today(), amount: 3000, name: 'SEND E-TFR ***9Kr' }));
    const id = (await query(`SELECT id FROM bank_activity`)).rows[0].id;
    let threw = false; try { await splitActivity(id, { parts: [{ category: 'Interest charges', amount: 2000 }, { category: 'Owner draw', amount: 900 }] }); } catch { threw = true; }
    assert(threw, 'parts that do not add up are refused');
    await splitActivity(id, { parts: [{ category: 'Interest charges', amount: 2000 }, { category: 'Owner draw - Ravi', amount: 1000 }], by: 't' });
    const ex = (await query(`SELECT category, amount FROM expenses ORDER BY ext_id`)).rows;
    equal(ex.length, 2); equal(ex[0].category, 'Interest charges'); equal(Number(ex[1].amount), 1000);
    equal((await query(`SELECT count(*)::int AS n FROM bank_activity`)).rows[0].n, 0, 'the transfer left the activity list');
    assert(await hasExpense('plaid:sp1'), 'the original bank id is recognised as already sorted');
  } finally { await done(); }
});

test('A CATEGORY THE OFFICE ADDS IS KEPT, NOT DUPLICATED, AND A NAME THE BOOKS TREAT SPECIALLY IS REFUSED', async () => {
  const { done } = await withTestDb();
  try {
    const { addCustomCategory, getCustomCategories } = await import('../lib/finance.js');
    equal(await addCustomCategory('  Packaging '), 'Packaging');
    equal(await addCustomCategory('packaging'), 'Packaging', 'same name is not added twice');
    equal(await addCustomCategory('Utilities'), 'Utilities', 'a built-in is not added as a custom one');
    equal((await getCustomCategories()).length, 1);
    let threw = false; try { await addCustomCategory('Owner loan top-up'); } catch { threw = true; }
    assert(threw, 'a name with loan/owner/draw/wage is refused');
  } finally { await done(); }
});

test('A PAYMENT RECORDED AS CASH THAT WAS REALLY AN E-TRANSFER CAN BE RELABELLED, AND LEAVES THE CASH LIST WITHOUT TOUCHING THE INVOICE', async () => {
  const { done } = await withTestDb();
  try {
    const { changeInvoicePaymentMethod } = await import('../lib/invoices.js');
    const inv = (await query(`INSERT INTO invoices (number, name, email, status, total, payment_method, paid_at) VALUES ('INV-9001','Test Buyer','t@x.ca','paid',1100,'Cash',now()) RETURNING id`)).rows[0].id;
    const pay = (await query(`INSERT INTO invoice_payments (invoice_id, amount, method, paid_at) VALUES ($1,1100,'Cash',now()) RETURNING id`, [inv])).rows[0].id;
    let live = (await bankrollSummary(today(), { days: 7 })).live;
    assert(live.some((l) => l.paymentId === pay), 'listed as a cash sale first');
    const r = await changeInvoicePaymentMethod(pay, 'etransfer');
    equal(r.to, 'E-transfer');
    live = (await bankrollSummary(today(), { days: 7 })).live;
    assert(!live.some((l) => l.paymentId === pay), 'no longer a cash sale');
    const i = (await query(`SELECT status, total, payment_method FROM invoices WHERE id = $1`, [inv])).rows[0];
    equal(i.status, 'paid'); equal(Number(i.total), 1100); equal(i.payment_method, 'E-transfer');
    let threw = false; try { await changeInvoicePaymentMethod(pay, 'bitcoin'); } catch { threw = true; }
    assert(threw, 'an unknown method is refused');
  } finally { await done(); }
});

test('EACH ACTIVE TRUCK GETS ITS OWN FUEL CATEGORY, AND A RETIRED ONE DOES NOT', async () => {
  const { done } = await withTestDb();
  try {
    const { getVehicleFuelCategories, getExtraCategories, addCustomCategory, EXPENSE_CATEGORIES } = await import('../lib/finance.js');
    await query(`CREATE TABLE IF NOT EXISTS vehicles (id serial PRIMARY KEY, name text NOT NULL, plate text, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`);
    await query(`INSERT INTO vehicles (name, active) VALUES ('Green F150', true), ('2024 Chevy Suburban', true), ('Old van', false)`);
    const t = await getVehicleFuelCategories();
    equal(t.join('|'), 'Fuel - 2024 Chevy Suburban|Fuel - Green F150');
    await addCustomCategory('Packaging');
    const extra = await getExtraCategories();
    assert(extra.includes('Fuel - Green F150') && extra.includes('Packaging') && !extra.some((c) => /Old van/.test(c)));
    for (const c of ['Fuel', 'Delivery (carriers we pay)', 'Advertising - Google', 'Advertising - Facebook / Instagram']) assert(EXPENSE_CATEGORIES.includes(c), c);
  } finally { await done(); }
});

// A payment to a supplier is counted once: when it is connected to what we owe.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { isSupplierPayment } from '../lib/supplier-payments.js';
import { journal } from '../lib/ledger.js';
import { profitAndLoss } from '../lib/pnl.js';
import { hstRemittance } from '../lib/analytics.js';
import { ensureFinanceSchema, setPurchaseInvoicePaid } from '../lib/finance.js';
import { torontoToday } from '../lib/constants.js';

suite('supplier payments are counted once');
test('every way it has been typed is recognised', () => {
  for (const c of ['Supplier Payment Secondshop', 'supplier payment ourr homw', 'Supplier Payment - Abi']) assert(isSupplierPayment(c), c);
  for (const c of ['Wages', 'Tools / supplies', 'Owner draw', '']) assert(!isSupplierPayment(c), c);
});

async function seed(client) {
  await ensureFinanceSchema();
  const today = torontoToday();
  await client.query(`INSERT INTO purchase_invoices (vendor, invoice_number, invoice_date, subtotal, tax, total) VALUES ('SecondShop','PS-1',$1,1000,130,1130)`, [today]);
  await client.query(`INSERT INTO expenses (incurred_on, category, vendor, amount, tax, source) VALUES ($1,'Supplier Payment Secondshop','SECONDSHOP INC.',1000,130,'plaid')`, [today]);
  await client.query(`INSERT INTO expenses (incurred_on, category, vendor, amount, tax, source) VALUES ($1,'Software','X',50,6.5,'plaid')`, [today]);
  return today;
}
const bankOut = (entries) => Math.round(entries.flatMap((e) => e.lines).filter((l) => l.code === '1000').reduce((a, l) => a + l.credit - l.debit, 0) * 100) / 100;
const net = (entries, code) => Math.round(entries.flatMap((e) => e.lines).filter((l) => l.code === code).reduce((a, l) => a + l.debit - l.credit, 0) * 100) / 100;
const tomorrow = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

test('THE BOOKS: nothing until it is marked paid, then exactly once, and never as a cost', async () => {
  const { client, done } = await withTestDb();
  try {
    const today = await seed(client);
    let j = await journal('2000-01-01', tomorrow(today));
    equal(bankOut(j), 56.5, 'only the software bill; the filed supplier line is a label');
    equal(net(j, '6000'), 50);
    const id = (await client.query('SELECT id FROM purchase_invoices')).rows[0].id;
    await setPurchaseInvoicePaid(id, today);
    j = await journal('2000-01-01', tomorrow(today));
    equal(bankOut(j), 1186.5, 'the 1,130 leaves the bank once');
    equal(net(j, '6000'), 50, 'stock is not an operating expense');
    equal(net(j, '2100'), 0, 'we no longer owe it');
    equal(net(j, '1300'), 136.5, 'HST claimed once on the stock, once on the software');
  } finally { done(); }
});
test('the profit statement leaves it out and says how much', async () => {
  const { client, done } = await withTestDb();
  try {
    await seed(client);
    const p = await profitAndLoss('month');
    const c = p.current;
    equal(c.expenses, 50); equal(c.supplierPayments, 1000);
    assert(!c.byCategory.some((x) => isSupplierPayment(x.category)));
  } finally { done(); }
});
test('the HST credit comes from the invoice only', async () => {
  const { client, done } = await withTestDb();
  try {
    await seed(client);
    const h = await hstRemittance('month');
    equal([h.current.credits.stock, h.current.credits.expenses], [130, 6.5]);
  } finally { done(); }
});

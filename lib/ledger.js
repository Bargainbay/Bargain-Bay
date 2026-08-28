// A real general ledger, derived rather than typed.
//
// THE IDEA: nobody here is going to key journal entries. But every document the
// app already holds implies its own double entry — an invoice is Dr receivable /
// Cr sales / Cr HST, a payment is Dr bank / Cr receivable, a stock invoice is Dr
// inventory / Dr HST recoverable / Cr bank. So the journal is COMPUTED from the
// source records on every read. Nothing to keep in sync, nothing to post, and
// the ledger can never drift from the documents it describes.
//
// Add opening balances as at a chosen date and that becomes a trial balance and
// a balance sheet.
//
// WHAT IT ASSUMES, and this is the honest limit: that an EXPENSE was paid from
// the bank on its date. Supplier invoices are the exception and are tracked
// properly — bought on credit, settled later, with accounts payable in between,
// because most of this shop's stock is bought on terms and pretending otherwise
// would both understate cash and hide a real liability.
//
// The consequence is specific and checkable: the BANK figure is derived from
// documents, not observed. Once the TD feed is live, the gap between it and the
// real balance measures what the documents are missing — cash spent without a
// receipt, an unrecorded draw. `bankDrift` exists for exactly that comparison.
import { query, hasDb } from './db';
import { round2, HST_RATE } from './constants';
import { getSetting, setSetting } from './settings';

const TZ = "AT TIME ZONE 'America/Toronto'";
const LT = (col) => `(${col} ${TZ})`;
const n = (v) => Number(v || 0);

const SALE = (t = 'o') => `(
  ${t}.status IN ('confirmed','ready','out_for_delivery','delivered')
  OR (${t}.status = 'pending_payment'
      AND EXISTS (SELECT 1 FROM invoices bi
                   WHERE bi.order_id = ${t}.id AND bi.status IN ('open','partial')))
)`;

// A deliberately small chart. Every account here is one this system can actually
// populate from its own records — an account nobody can post to is a line of
// zeros that makes a statement look more complete than it is.
//
// `type` drives which statement a balance lands on and which way round it reads:
// asset and expense accounts are debit-normal, the rest credit-normal.
export const ACCOUNTS = {
  1000: { name: 'Bank — TD', type: 'asset', opening: true },
  1100: { name: 'Accounts receivable', type: 'asset', derived: true },
  1200: { name: 'Inventory', type: 'asset', opening: true },
  1300: { name: 'HST recoverable (ITCs)', type: 'asset', derived: true },
  2000: { name: 'HST collected', type: 'liability', derived: true },
  2100: { name: 'Accounts payable (suppliers)', type: 'liability', opening: true, derived: true },
  2200: { name: 'Loans & other liabilities', type: 'liability', opening: true, manualOnly: true },
  3000: { name: "Owner's equity (opening)", type: 'equity', opening: true },
  4000: { name: 'Sales', type: 'income', derived: true },
  4200: { name: 'Other income (restocking fees)', type: 'income', derived: true },
  5000: { name: 'Cost of goods sold', type: 'expense', derived: true },
  6000: { name: 'Operating expenses', type: 'expense', derived: true },
  6100: { name: 'Advertising', type: 'expense', derived: true },
  6200: { name: 'Wages & subcontractors', type: 'expense', derived: true }
};

export const DEBIT_NORMAL = new Set(['asset', 'expense']);

// ---- opening balances ------------------------------------------------------
// The conversion entry: what the business was worth on the day it started
// keeping books here. Stored as one settings blob — it is a handful of numbers
// entered once, not a table anyone queries.
export async function getOpeningBalances() {
  const v = await getSetting('opening_balances', null);
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(v?.asOf || '')) ? v.asOf : null;
  const accounts = {};
  for (const code of Object.keys(ACCOUNTS)) accounts[code] = round2(n(v?.accounts?.[code]));
  return { asOf, accounts, set: !!asOf };
}

export async function setOpeningBalances({ asOf, accounts } = {}) {
  const d = String(asOf || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Give the date the balances are as at, like 2026-09-01.');
  const clean = {};
  for (const code of Object.keys(ACCOUNTS)) clean[code] = round2(n(accounts?.[code]));
  await setSetting('opening_balances', { asOf: d, accounts: clean });
  return { asOf: d, accounts: clean };
}

// Equity is the balancing figure, not something anyone should be asked to know.
// Assets − liabilities, at the opening date. Reported separately so a number
// that looks wrong is visible rather than buried inside the total.
export function derivedOpeningEquity(accounts) {
  let assets = 0, liabilities = 0;
  for (const [code, a] of Object.entries(ACCOUNTS)) {
    if (!a.opening || code === '3000') continue;
    const v = round2(n(accounts?.[code]));
    if (a.type === 'asset') assets += v;
    if (a.type === 'liability') liabilities += v;
  }
  return round2(assets - liabilities);
}

// ---- the journal -----------------------------------------------------------
// Every entry is written as a balanced pair, so the trial balance balances by
// construction rather than by luck. If it ever doesn't, the bug is here.
function entry(date, memo, ref, lines) {
  return { date, memo, ref, lines };
}

// Everything that happened between two dates, as journal entries.
export async function journal(from, to) {
  if (!hasDb()) return [];
  const out = [];
  const safe = async (sql, args = []) => { try { return (await query(sql, args)).rows; } catch { return []; } };
  const range = `>= $1 AND %COL% < $2`;

  // 1. A sale, on the day it was made: the customer owes us, we've earned the
  //    goods value, and we're holding the CRA's tax.
  for (const r of await safe(
    `SELECT i.number, ${LT('i.created_at')}::date AS d, i.subtotal, i.hst, i.total
       FROM invoices i
      WHERE i.status <> 'void' AND ${LT('i.created_at')} >= $1 AND ${LT('i.created_at')} < $2
      ORDER BY i.created_at, i.id`, [from, to])) {
    const sub = round2(n(r.subtotal)), hst = round2(n(r.hst)), tot = round2(n(r.total));
    if (!tot) continue;
    out.push(entry(r.d, `Invoice ${r.number}`, r.number, [
      { code: '1100', debit: tot, credit: 0 },
      { code: '4000', debit: 0, credit: sub },
      ...(hst ? [{ code: '2000', debit: 0, credit: hst }] : [])
    ]));
  }

  // 2. Money arriving against those invoices.
  for (const r of await safe(
    `SELECT i.number, ${LT('p.paid_at')}::date AS d, p.amount
       FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE ${LT('p.paid_at')} >= $1 AND ${LT('p.paid_at')} < $2
      ORDER BY p.paid_at, p.id`, [from, to])) {
    const amt = round2(n(r.amount));
    if (!amt) continue;
    out.push(entry(r.d, `Payment on ${r.number}`, r.number, [
      { code: '1000', debit: amt, credit: 0 },
      { code: '1100', debit: 0, credit: amt }
    ]));
  }

  // 3. Refunds: money back out, the sale and its tax reversed. A restocking fee
  //    kept is income we earned for the trouble, so it lands separately.
  for (const r of await safe(
    `SELECT i.number, ${LT('r.created_at')}::date AS d, r.amount, r.restocking_fee
       FROM invoice_refunds r JOIN invoices i ON i.id = r.invoice_id
      WHERE ${LT('r.created_at')} >= $1 AND ${LT('r.created_at')} < $2
      ORDER BY r.created_at, r.id`, [from, to])) {
    const amt = round2(n(r.amount));
    const fee = round2(n(r.restocking_fee));
    if (!amt && !fee) continue;
    const base = round2(amt / (1 + HST_RATE));
    const tax = round2(amt - base);
    const lines = [
      { code: '4000', debit: base, credit: 0 },
      ...(tax ? [{ code: '2000', debit: tax, credit: 0 }] : []),
      { code: '1000', debit: 0, credit: amt }
    ];
    if (amt) out.push(entry(r.d, `Refund on ${r.number}`, r.number, lines));
    if (fee) {
      out.push(entry(r.d, `Restocking fee kept on ${r.number}`, r.number, [
        { code: '1100', debit: fee, credit: 0 },
        { code: '4200', debit: 0, credit: fee }
      ]));
    }
  }

  // 4. Cost of goods, on the day the unit sold. This is what moves value out of
  //    inventory and into the P&L; without it inventory only ever grows.
  for (const r of await safe(
    `SELECT ${LT('o.created_at')}::date AS d, o.order_number,
            COALESCE(SUM(COALESCE(oi.cost, p.cost)),0) AS cogs
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.sku = oi.sku
      WHERE ${SALE('o')} AND COALESCE(oi.kind,'unit') = 'unit'
        AND ${LT('o.created_at')} >= $1 AND ${LT('o.created_at')} < $2
      GROUP BY 1, 2 ORDER BY 1`, [from, to])) {
    const c = round2(n(r.cogs));
    if (!c) continue;
    out.push(entry(r.d, `Cost of goods — ${r.order_number || 'sale'}`, r.order_number, [
      { code: '5000', debit: c, credit: 0 },
      { code: '1200', debit: 0, credit: c }
    ]));
  }

  // 5. Stock bought: value into inventory, the tax recoverable, and the money
  //    OWED — not spent. Most of this shop's supplier invoices sit unpaid for a
  //    while, so booking them straight against the bank would both understate
  //    cash and hide a real liability.
  for (const r of await safe(
    `SELECT invoice_date AS d, vendor, invoice_number, subtotal, tax, total, paid_at
       FROM purchase_invoices
      WHERE invoice_date >= $1 AND invoice_date < $2
      ORDER BY invoice_date, id`, [from, to])) {
    const sub = round2(n(r.subtotal)), tax = round2(n(r.tax));
    const tot = round2(n(r.total)) || round2(sub + tax);
    if (!tot) continue;
    const who = `${r.vendor || 'supplier'} ${r.invoice_number || ''}`.trim();
    out.push(entry(r.d, `Stock — ${who}`, r.invoice_number, [
      { code: '1200', debit: sub || round2(tot - tax), credit: 0 },
      ...(tax ? [{ code: '1300', debit: tax, credit: 0 }] : []),
      { code: '2100', debit: 0, credit: tot }
    ]));
  }

  // 5b. Settling one of those. Dated to when it was PAID, which is the whole
  //     point of tracking it separately — the liability and the cash leave on
  //     different days, often in different months.
  for (const r of await safe(
    `SELECT paid_at AS d, vendor, invoice_number, subtotal, tax, total
       FROM purchase_invoices
      WHERE paid_at IS NOT NULL AND paid_at >= $1 AND paid_at < $2
      ORDER BY paid_at, id`, [from, to])) {
    const tot = round2(n(r.total)) || round2(n(r.subtotal) + n(r.tax));
    if (!tot) continue;
    out.push(entry(r.d, `Paid supplier — ${r.vendor || ''} ${r.invoice_number || ''}`.trim(), r.invoice_number, [
      { code: '2100', debit: tot, credit: 0 },
      { code: '1000', debit: 0, credit: tot }
    ]));
  }

  // 6. Operating expenses. Wages go to their own account — an accountant looks
  //    for them there, and payroll is the line most often asked about.
  for (const r of await safe(
    `SELECT incurred_on AS d, vendor, category, amount, tax
       FROM expenses
      WHERE incurred_on >= $1 AND incurred_on < $2
      ORDER BY incurred_on, id`, [from, to])) {
    const amt = round2(n(r.amount)), tax = round2(n(r.tax));
    const tot = round2(amt + tax);
    if (!tot) continue;
    // Not everything leaving the bank is a cost. A loan repayment pays down a
    // liability and an owner draw reduces equity; booking either as an expense
    // understates profit by the whole amount, and both look identical to an
    // ordinary withdrawal in a bank feed.
    const cat = String(r.category || '');
    const code = /loan|repayment/i.test(cat) ? '2200'
      : /owner|draw/i.test(cat) ? '3000'
      : /wage|payroll|subcontract/i.test(cat) ? '6200'
      : '6000';
    out.push(entry(r.d, `${r.vendor || r.category || 'Expense'}`, null, [
      { code, debit: amt, credit: 0 },
      ...(tax ? [{ code: '1300', debit: tax, credit: 0 }] : []),
      { code: '1000', debit: 0, credit: tot }
    ]));
  }

  // 7. Ad spend — its own account because ROAS is looked at separately.
  for (const r of await safe(
    `SELECT spent_on AS d, channel, amount, tax FROM ad_spend
      WHERE spent_on >= $1 AND spent_on < $2 ORDER BY spent_on, id`, [from, to])) {
    const amt = round2(n(r.amount)), tax = round2(n(r.tax));
    const tot = round2(amt + tax);
    if (!tot) continue;
    out.push(entry(r.d, `Ads — ${r.channel || 'spend'}`, null, [
      { code: '6100', debit: amt, credit: 0 },
      ...(tax ? [{ code: '1300', debit: tax, credit: 0 }] : []),
      { code: '1000', debit: 0, credit: tot }
    ]));
  }

  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

// ---- trial balance ---------------------------------------------------------
// Opening balances plus every entry since. Debits must equal credits; the page
// says so out loud, because a trial balance that doesn't is the only real
// evidence that something upstream is broken.
export async function trialBalance(asAt = null) {
  if (!hasDb()) return null;
  const opening = await getOpeningBalances();
  if (!opening.set) return { needsOpening: true, opening };

  const to = asAt || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const entries = await journal(opening.asOf, to);

  const bal = {};
  for (const code of Object.keys(ACCOUNTS)) bal[code] = 0;

  // The conversion entry itself, with equity as the balancing side.
  for (const [code, a] of Object.entries(ACCOUNTS)) {
    if (!a.opening || code === '3000') continue;
    const v = opening.accounts[code] || 0;
    bal[code] += a.type === 'asset' ? v : -v;
  }
  bal['3000'] -= derivedOpeningEquity(opening.accounts);

  // Signed: debit positive, credit negative. One convention, applied once.
  for (const e of entries) {
    for (const l of e.lines) {
      if (bal[l.code] === undefined) bal[l.code] = 0;
      bal[l.code] += round2(n(l.debit) - n(l.credit));
    }
  }

  const rows = Object.entries(ACCOUNTS).map(([code, a]) => {
    const signed = round2(bal[code] || 0);
    return {
      code, name: a.name, type: a.type,
      debit: signed > 0 ? signed : 0,
      credit: signed < 0 ? round2(-signed) : 0,
      // How it reads on a statement: debit-normal accounts positive when debit.
      balance: DEBIT_NORMAL.has(a.type) ? signed : round2(-signed)
    };
  });

  const debits = round2(rows.reduce((a, r) => a + r.debit, 0));
  const credits = round2(rows.reduce((a, r) => a + r.credit, 0));

  return {
    needsOpening: false,
    opening,
    from: opening.asOf,
    to,
    rows,
    debits,
    credits,
    // Should be zero. Rounding could in principle leave a cent; anything larger
    // is a real defect in the derivation above.
    outOfBalance: round2(debits - credits),
    entryCount: entries.length
  };
}

// The balance sheet, from the same numbers.
export async function balanceSheet(asAt = null) {
  const tb = await trialBalance(asAt);
  if (!tb || tb.needsOpening) return tb;
  const pick = (type) => tb.rows.filter((r) => r.type === type && Math.abs(r.balance) > 0.005);

  const assets = pick('asset');
  const liabilities = pick('liability');
  const equityRows = pick('equity');
  const totalAssets = round2(assets.reduce((a, r) => a + r.balance, 0));
  const totalLiabilities = round2(liabilities.reduce((a, r) => a + r.balance, 0));
  const openingEquity = round2(equityRows.reduce((a, r) => a + r.balance, 0));

  // Profit since the opening date is equity too — it just hasn't been closed out
  // to the equity account, because nothing here closes a year.
  const income = round2(tb.rows.filter((r) => r.type === 'income').reduce((a, r) => a + r.balance, 0));
  const expenses = round2(tb.rows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.balance, 0));
  const earnings = round2(income - expenses);

  return {
    ...tb,
    assets, liabilities,
    totalAssets, totalLiabilities,
    openingEquity, earnings,
    totalEquity: round2(openingEquity + earnings),
    // Assets = liabilities + equity. Reported, not assumed.
    check: round2(totalAssets - (totalLiabilities + openingEquity + earnings))
  };
}

// What the ledger thinks is in the bank, for comparing against the real TD
// balance once the feed is live. The gap is the measure of what the documents
// are missing — unrecorded cash, a purchase bought on terms, an owner draw.
export async function bankDrift(actualBalance) {
  const tb = await trialBalance();
  if (!tb || tb.needsOpening) return null;
  const derived = tb.rows.find((r) => r.code === '1000')?.balance ?? 0;
  const actual = round2(n(actualBalance));
  return { derived: round2(derived), actual, gap: round2(actual - derived) };
}

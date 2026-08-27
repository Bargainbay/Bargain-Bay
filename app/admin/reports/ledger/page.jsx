import { redirect } from 'next/navigation';
import { getSession, isAdmin, canKeepBooks } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { money, BUSINESS_NAME, BUSINESS_LEGAL, HST_NUMBER } from '../../../../lib/constants';
import { balanceSheet, getOpeningBalances, ACCOUNTS } from '../../../../lib/ledger';
import { inventoryAtCost, unpaidPurchaseInvoices } from '../../../../lib/finance';
import AdminNav from '../../../../components/AdminNav';
import PrintButton from '../../../../components/PrintButton';
import OpeningBalances from '../../../../components/OpeningBalances';
import PayablesList from '../../../../components/PayablesList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trial balance — Bargain Bay' };

// What each opening figure is, in the words the person typing it would use.
const HELP = {
  1000: 'The balance in the TD account on that morning, straight off the app.',
  1200: 'What ALL the stock on hand cost you — not what it sells for. Sellable, untested and salvage.',
  2100: 'Supplier invoices still unpaid on that date, including any carried over.',
  2200: 'Loans and credit-card balances. Not supplier bills — those go on the line above.'
};

export default async function LedgerPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/reports/ledger');
  const admin = isAdmin(session);
  if (!(await canKeepBooks(session))) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>{session.email} doesn&apos;t have access to the books.</p>
    </div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="books" booksOnly={!admin} /><div className="panel">Database not configured.</div></div>);

  const opening = await getOpeningBalances().catch(() => ({ set: false, accounts: {} }));
  const openingAccounts = Object.entries(ACCOUNTS)
    .filter(([, a]) => a.opening && a.type !== 'equity')
    .map(([code, a]) => ({ code, name: a.name, type: a.type, help: HELP[code] || '' }));

  const bs = opening.set ? await balanceSheet().catch(() => null) : null;
  // What the stock is actually worth at cost, broken out — the storefront's
  // "inventory capital" counts only ACTIVE sellable units, which is the wrong
  // number for a balance sheet and the easiest one to reach for by mistake.
  const stock = await inventoryAtCost().catch(() => null);
  const owing = await unpaidPurchaseInvoices().catch(() => []);
  const owingTotal = owing.reduce((a, r) => a + r.total, 0);

  return (
    <div>
      <div className="no-print"><AdminNav active="books" booksOnly={!admin} /></div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <div>
          <h1 style={{ color: 'var(--charcoal)', margin: 0 }}>Trial balance &amp; balance sheet</h1>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {BUSINESS_LEGAL} ({BUSINESS_NAME}) · GST/HST # {HST_NUMBER}
            {bs && <><br />{bs.from} to {bs.to} · {bs.entryCount} journal entries</>}
          </p>
        </div>
        {bs && (
          <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <a className="btn" href="/api/admin/ledger" style={{ fontSize: 12.5 }}>General ledger CSV</a>
            <a className="btn" href="/admin/reports/books" style={{ fontSize: 12.5 }}>The books</a>
            <PrintButton label="Print / PDF" />
          </div>
        )}
      </div>

      {!opening.set && (
        <div className="notice-box" style={{ lineHeight: 1.6 }}>
          <b>The ledger needs a starting point.</b> Enter what the business was worth on the day you began
          keeping books here and every statement below builds itself from your own records.
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Opening balances</h2>
        <OpeningBalances accounts={openingAccounts} initial={opening} canEdit={admin} />

        {/* The two figures that are easiest to get wrong, computed from the
            system's own records so they don't have to be guessed at. */}
        {stock && (
          <div className="hint" style={{ marginTop: 12, lineHeight: 1.7 }}>
            <b>Stock on hand, at cost — {money(stock.total)}.</b> That&apos;s {money(stock.sellable)} sellable
            ({stock.sellableUnits} units){stock.unlisted > 0 ? <>, {money(stock.unlisted)} bought but not listed
            ({stock.unlistedUnits})</> : null}{stock.salvage > 0 ? <>, and {money(stock.salvage)} salvage
            ({stock.salvageUnits})</> : null}. The Financial tab&apos;s &ldquo;inventory capital&rdquo; shows only the
            sellable part — a balance sheet wants everything you own.
            {owing.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <b>Unpaid supplier invoices already on file — {money(owingTotal)}</b> across {owing.length}.
                Anything owed from <i>before</i> your opening date goes in the payables box above; these are
                already counted from the date they were raised, so don&apos;t enter them twice.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
          Owed to suppliers
          {owing.length > 0 && <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>{owing.length}</span>}
        </h2>
        <PayablesList initial={owing} canEdit={admin} />
      </div>

      {bs && (
        <>
          <div className="panel" style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Trial balance</h2>
              {/* The one check that proves the derivation is sound. Shown, not
                  assumed — a trial balance that doesn't balance is the only real
                  evidence something upstream is broken. */}
              <span className={Math.abs(bs.outOfBalance) < 0.02 ? 'pill ok' : 'pill sold'} style={{ fontSize: 11 }}>
                {Math.abs(bs.outOfBalance) < 0.02 ? 'balances' : `out by ${money(bs.outOfBalance)}`}
              </span>
            </div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="admin">
                <thead><tr><th>Code</th><th>Account</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th></tr></thead>
                <tbody>
                  {bs.rows.filter((r) => r.debit || r.credit).map((r) => (
                    <tr key={r.code}>
                      <td style={{ color: 'var(--muted)' }}>{r.code}</td>
                      <td>{r.name}</td>
                      <td style={{ textAlign: 'right' }}>{r.debit ? money(r.debit) : ''}</td>
                      <td style={{ textAlign: 'right' }}>{r.credit ? money(r.credit) : ''}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                    <td colSpan={2}>Totals</td>
                    <td style={{ textAlign: 'right' }}>{money(bs.debits)}</td>
                    <td style={{ textAlign: 'right' }}>{money(bs.credits)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Balance sheet · as at {bs.to}</h2>
            <div className="table-wrap">
              <table className="admin">
                <tbody>
                  <tr><td colSpan={2} style={{ fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 11.5, letterSpacing: '.05em' }}>Assets</td></tr>
                  {bs.assets.map((r) => (
                    <tr key={r.code}><td style={{ paddingLeft: 20 }}>{r.name}</td><td style={{ textAlign: 'right' }}>{money(r.balance)}</td></tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}><td>Total assets</td><td style={{ textAlign: 'right' }}>{money(bs.totalAssets)}</td></tr>

                  <tr><td colSpan={2} style={{ paddingTop: 14, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 11.5, letterSpacing: '.05em' }}>Liabilities</td></tr>
                  {bs.liabilities.length === 0 && <tr><td style={{ paddingLeft: 20, color: 'var(--muted)' }}>None recorded</td><td style={{ textAlign: 'right' }}>{money(0)}</td></tr>}
                  {bs.liabilities.map((r) => (
                    <tr key={r.code}><td style={{ paddingLeft: 20 }}>{r.name}</td><td style={{ textAlign: 'right' }}>{money(r.balance)}</td></tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}><td>Total liabilities</td><td style={{ textAlign: 'right' }}>{money(bs.totalLiabilities)}</td></tr>

                  <tr><td colSpan={2} style={{ paddingTop: 14, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 11.5, letterSpacing: '.05em' }}>Equity</td></tr>
                  <tr><td style={{ paddingLeft: 20 }}>Opening equity</td><td style={{ textAlign: 'right' }}>{money(bs.openingEquity)}</td></tr>
                  <tr><td style={{ paddingLeft: 20 }}>Earnings since {bs.from}</td><td style={{ textAlign: 'right' }}>{money(bs.earnings)}</td></tr>
                  <tr style={{ fontWeight: 700 }}><td>Total equity</td><td style={{ textAlign: 'right' }}>{money(bs.totalEquity)}</td></tr>

                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
                    <td>Liabilities + equity</td>
                    <td style={{ textAlign: 'right' }}>{money(bs.totalLiabilities + bs.totalEquity)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {Math.abs(bs.check) >= 0.02 && (
              <div className="error-box">Assets don&apos;t equal liabilities plus equity — out by {money(bs.check)}. That&apos;s a defect, not a data problem; tell whoever maintains this.</div>
            )}
          </div>

          {/* The honest caveat, and it is a specific, checkable one rather than
              a disclaimer. */}
          <div className="notice-box" style={{ lineHeight: 1.6 }}>
            <b>The bank figure here is derived, not observed.</b> Every entry is built from a document, and each one
            assumes it was paid from the bank — there is no accounts-payable tracking, so a supplier invoice bought
            on terms is treated as paid the day it was dated. Compare <b>{money(bs.assets.find((a) => a.code === '1000')?.balance || 0)}</b> against
            the real TD balance: the gap is the measure of what the records are missing — cash spent without a
            receipt, something bought on credit, an owner draw. Once the bank feed is live that comparison becomes
            automatic.
          </div>
        </>
      )}
    </div>
  );
}

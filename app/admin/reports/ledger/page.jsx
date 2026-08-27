import { redirect } from 'next/navigation';
import { getSession, isAdmin, canKeepBooks } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { money, BUSINESS_NAME, BUSINESS_LEGAL, HST_NUMBER } from '../../../../lib/constants';
import { balanceSheet, getOpeningBalances, ACCOUNTS } from '../../../../lib/ledger';
import AdminNav from '../../../../components/AdminNav';
import PrintButton from '../../../../components/PrintButton';
import OpeningBalances from '../../../../components/OpeningBalances';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trial balance — Bargain Bay' };

// What each opening figure is, in the words the person typing it would use.
const HELP = {
  1000: 'The balance in the TD account on that morning, straight off the app.',
  1200: 'What the stock on hand cost you — not what it sells for.',
  2200: 'Anything owed: a loan, a credit-card balance, unpaid supplier bills.'
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

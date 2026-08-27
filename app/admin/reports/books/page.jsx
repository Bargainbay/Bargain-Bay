import { redirect } from 'next/navigation';
import { getSession, isAdmin, canKeepBooks } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { money, BUSINESS_NAME, BUSINESS_LEGAL, HST_NUMBER } from '../../../../lib/constants';
import { booksSummary, BOOK_PERIODS } from '../../../../lib/books';
import { listAccountants } from '../../../../lib/accountants';
import AdminNav from '../../../../components/AdminNav';
import AccountantAccess from '../../../../components/AccountantAccess';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The books — Bargain Bay' };

// Everything an accountant is handed, in one place, each section downloadable.
export default async function BooksPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/admin/reports/books');
  const admin = isAdmin(session);
  if (!(await canKeepBooks(session))) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>
        {session.email} doesn&apos;t have access to the books. An admin can grant it under
        Reports → The books.
      </p>
    </div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="operations" booksOnly={!admin} /><div className="panel">Database not configured.</div></div>);

  const period = BOOK_PERIODS.some((p) => p.key === sp?.period) ? sp.period : 'month';
  const b = await booksSummary(period).catch(() => null);
  const accountants = admin ? await listAccountants().catch(() => []) : [];
  if (!b) return (<div><AdminNav active="operations" booksOnly={!admin} /><div className="error-box">Could not load the records.</div></div>);

  return (
    <div>
      <AdminNav active="operations" booksOnly={!admin} />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <div>
          <h1 style={{ color: 'var(--charcoal)', margin: 0 }}>The books</h1>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {BUSINESS_LEGAL} ({BUSINESS_NAME}) · GST/HST # {HST_NUMBER}<br />
            {b.label} — {b.from} to {b.to}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BOOK_PERIODS.map((x) => (
            <a key={x.key} href={`/admin/reports/books?period=${x.key}`}
              className={'btn' + (x.key === period ? ' accent' : '')} style={{ fontSize: 12.5 }}>{x.label}</a>
          ))}
        </div>
      </div>

      <div className="dash-kpis">
        <div className="kpi-card">
          <div className="kpi-value">{money(b.revenue)}</div>
          <div className="kpi-label">Revenue (ex-HST)</div>
          <div className="kpi-sub">{b.orders} order{b.orders === 1 ? '' : 's'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{money(b.hstCharged)}</div>
          <div className="kpi-label">HST charged</div>
          <div className="kpi-sub">before input tax credits</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{money(b.collected)}</div>
          <div className="kpi-label">Payments received</div>
          <div className="kpi-sub">money that actually landed</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Records for this period</h2>
        <div className="table-wrap">
          <table className="admin">
            <thead><tr><th>Section</th><th style={{ textAlign: 'right' }}>Rows</th><th style={{ textAlign: 'right' }}>Total</th><th /></tr></thead>
            <tbody>
              {Object.entries(b.sections).map(([key, s]) => (
                <tr key={key}>
                  <td>{s.label}</td>
                  <td style={{ textAlign: 'right' }}>{s.count}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(s.total)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {s.count > 0
                      ? <a className="btn" style={{ fontSize: 12.5 }} href={`/api/admin/books?section=${key}&period=${period}`}>Download CSV</a>
                      : <span className="hint" style={{ fontSize: 11.5 }}>nothing to export</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <a className="btn accent" href={`/admin/reports/pnl?period=${period}`}>Profit &amp; loss statement →</a>
          <a className="btn" href={`/api/admin/pnl?period=${period}`}>P&amp;L as CSV</a>
          <a className="btn" href="/admin/reports/ledger">Trial balance &amp; balance sheet →</a>
          <a className="btn" href="/admin/financial">Expense ledger →</a>
        </div>
      </div>

      {/* Said plainly, because an accountant will ask inside five minutes and
          because the owner is deciding whether to stop paying for QuickBooks. */}
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        <b>What this pack is, and what it isn&apos;t.</b> It is a complete set of source records — every invoice,
        payment, refund, expense and stock purchase in the period, each traceable to its document, plus a P&amp;L
        built from them.
        <div style={{ marginTop: 6 }}>
          A double-entry <b>general ledger, trial balance and balance sheet</b> are built from these same records
          — see <a href="/admin/reports/ledger" style={{ textDecoration: 'underline' }}>Trial balance</a>, once
          opening balances are entered. What is still <b>not</b> here: accounts payable, so anything bought on
          terms is treated as paid on its date, and the bank figure is derived from documents rather than read
          from the account. That page says so, and shows what to compare it against.
        </div>
      </div>

      {admin && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
            Who can see the books
            {accountants.filter((a) => a.active).length > 0 && (
              <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>{accountants.filter((a) => a.active).length} active</span>
            )}
          </h2>
          <AccountantAccess initial={accountants} />
        </div>
      )}
    </div>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import { REPORT_GROUPS } from '../../../lib/reports';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports — Bargain Bay' };

// Every report in one place.
//
// This route used to be a redirect to the dashboard, left behind when the
// Reports tab was folded into it. Meanwhile the P&L, the general ledger and the
// financial dashboard were in the ACCOUNTANT's nav and in nobody else's — so
// the owner could reach the reports describing his own business only by typing
// the URL, and four fully-built dashboards sat behind a greyed-out "SOON" tag.
//
// A hub rather than more top-level tabs: the nav is already sixteen items, and
// reports are what somebody goes LOOKING for rather than what they work in all
// day. One click to here, one to the report.
export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/reports');
  if (!isAdmin(session)) redirect('/admin');

  return (
    <div>
      <AdminNav active="reports" />
      <div className="wrap">
        <h1 style={{ marginBottom: 4, color: 'var(--charcoal)' }}>Reports</h1>
        <p className="hint" style={{ marginTop: 0 }}>
          Everything this system can tell you about the business. Each one says what question it
          answers, because that is what you are looking for — not what it is called.
        </p>

        {REPORT_GROUPS.map((g) => (
          <section key={g.key} style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 2px', color: 'var(--charcoal)' }}>{g.title}</h2>
            <p className="hint" style={{ margin: '0 0 10px', fontSize: 13 }}>{g.blurb}</p>
            <div className="report-grid">
              {g.reports.map((r) => (
                <a key={r.key} href={r.href} className="report-card">
                  <b>{r.label}</b>
                  <span className="report-asks">{r.asks}</span>
                  <span className="report-note">{r.note}</span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

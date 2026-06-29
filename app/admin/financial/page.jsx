import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import DashboardShell, { ComingSoon } from '../../../components/DashboardShell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Financial — Bargain Bay' };

export default async function FinancialDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/financial');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  return (
    <DashboardShell active="financial">
      <ComingSoon
        title="Financial health"
        blurb="Margin, money owed and cash — so you can make decisions on facts, not vibes."
        points={[
          'Revenue → COGS → gross profit & margin trend',
          'Accounts-receivable aging (overdue invoices)',
          'Collections by method (cash / e-transfer) + inventory capital',
          'Net profit & cash flow from your expense + cash entries (new capture)'
        ]}
      />
    </DashboardShell>
  );
}

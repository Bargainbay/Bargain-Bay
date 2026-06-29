import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import DashboardShell, { ComingSoon } from '../../../components/DashboardShell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marketing — Bargain Bay' };

export default async function MarketingDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/marketing');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  return (
    <DashboardShell active="marketing">
      <ComingSoon
        title="Marketing & leads"
        blurb="Where leads come from and what they turn into — across the channels you run."
        points={[
          'Leads: quote requests, signups & contact form over time',
          'Lead → quote → sale conversion funnel',
          'Campaign sends (email / SMS) once logging is on',
          'Ad spend → ROAS / cost-per-lead (new capture)'
        ]}
      />
    </DashboardShell>
  );
}

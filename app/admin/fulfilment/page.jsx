import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import DashboardShell, { ComingSoon } from '../../../components/DashboardShell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fulfilment — Bargain Bay' };

export default async function FulfilmentDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/fulfilment');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  return (
    <DashboardShell active="fulfilment">
      <ComingSoon
        title="Fulfilment & supply chain"
        blurb="Operations health — deliveries, pickups and bottlenecks, from real order/driver data."
        points={[
          'Orders by stage (confirmed → ready → out → delivered)',
          'On-time vs delayed deliveries',
          'Delivery vs pickup split & avg time-to-fulfil',
          'Driver workload & proof-of-delivery completion'
        ]}
      />
    </DashboardShell>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import DashboardShell, { ComingSoon } from '../../../components/DashboardShell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customers — Bargain Bay' };

export default async function CustomersDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/customers');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  return (
    <DashboardShell active="customers">
      <ComingSoon
        title="Customer insights"
        blurb="Who's buying, who's coming back, and where they are — plus the full customer & member database."
        points={[
          'New vs returning & repeat-purchase rate',
          'Segments: members vs retail, by spend tier',
          'Geography by city (from delivery addresses)',
          'Satisfaction from post-delivery ratings (new capture)'
        ]}
      />
    </DashboardShell>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listCosts } from '../../../lib/daily-pnl';
import AdminNav from '../../../components/AdminNav';
import CostList from '../../../components/CostList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cost list — Bargain Bay' };

export default async function CostsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/costs');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  return (
    <div>
      <AdminNav active="daily-pnl" />
      {!hasDb() ? <div className="panel">Database not configured.</div> : <CostList costs={await listCosts()} />}
    </div>
  );
}

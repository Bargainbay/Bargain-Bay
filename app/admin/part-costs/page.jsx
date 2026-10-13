import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { recentPartCosts } from '../../../lib/part-costs';
import AdminNav from '../../../components/AdminNav';
import PartCosts from '../../../components/PartCosts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parts costs — Bargain Bay' };

export default async function PartCostsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/part-costs');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="parts" /><div className="panel">Database not configured.</div></div>);
  const recent = await recentPartCosts().catch(() => []);
  return (<div><AdminNav active="parts" /><PartCosts recent={JSON.parse(JSON.stringify(recent))} /></div>);
}

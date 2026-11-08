import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import ServicesEditor from '../../../components/ServicesEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Service prices — Bargain Bay' };

export default async function ServicesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/sales-services');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Service costs are for the owner only.</p>
    </div></div>);
  }
  return (
    <div>
      <AdminNav active="sales-services" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Service prices &amp; costs</h1>
      {!hasDb() ? <div className="error-box">Database isn&apos;t configured.</div> : <ServicesEditor />}
    </div>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import PayrollManager from '../../../components/PayrollManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payroll — Bargain Bay' };

export default async function PayrollPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/payroll');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  return (
    <div>
      <AdminNav active="payroll" />
      {!hasDb()
        ? <div className="panel">Database not configured — set POSTGRES_URL.</div>
        : <PayrollManager />}
    </div>
  );
}

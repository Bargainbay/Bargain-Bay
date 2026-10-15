import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import PaymentsIn from '../../../components/PaymentsIn';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payments in — Bargain Bay' };

export default async function PaymentsInPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/payments-in');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p></div></div>);
  }
  if (!hasDb()) return <div><AdminNav active="payments-in" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  return (<div><AdminNav active="payments-in" salesOnly={!isAdmin(session)} /><PaymentsIn /></div>);
}

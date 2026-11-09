import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import ReferralPartnersAdmin from '../../../components/ReferralPartnersAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Referral partners — Bargain Bay' };

export default async function ReferralPartnersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/referral-partners');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Referral partners are for the owner only.</p>
    </div></div>);
  }
  return (
    <div>
      <AdminNav active="reports" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Referral partners</h1>
      <ReferralPartnersAdmin />
    </div>
  );
}

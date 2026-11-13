import { redirect } from 'next/navigation';
import { getSession, isStaff } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import PartnerLeadQueue from '../../../components/PartnerLeadQueue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner leads — Bargain Bay' };

export default async function PartnerLeadsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/partner-leads');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1><p style={{ fontSize: 14 }}>Partner leads are for the sales team.</p></div></div>);
  }
  return (
    <div>
      <AdminNav active="partner-leads" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Partner leads</h1>
      <p className="hint" style={{ marginTop: 0 }}>Warm leads sent by our partners&rsquo; lead generators. The person contacted the generator first, so they are expecting to hear from us: claim one and call. The generator sees only the plain status of each lead, never your notes.</p>
      <PartnerLeadQueue />
    </div>
  );
}

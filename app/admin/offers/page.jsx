import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listOffersAdmin } from '../../../lib/member-offers';
import AdminNav from '../../../components/AdminNav';
import AdminOffers from '../../../components/AdminOffers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Offers — Bargain Bay' };

export default async function OffersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/offers');
  if (!isAdmin(session)) {
    return <div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) is not on the admin list.</p></div></div>;
  }
  if (!hasDb()) return <div><AdminNav active="offers" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  const offers = await listOffersAdmin({ status: 'open' });
  return (
    <div>
      <AdminNav active="offers" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Offers</h1>
      <p className="hint">Each offer says whether it came from a reseller or a retail customer. Accepting holds the unit for 48 hours (resellers) or 24 hours (retail) at the agreed price. Offers under the floor are refused when they are made and again here.</p>
      <AdminOffers initial={offers} />
    </div>
  );
}

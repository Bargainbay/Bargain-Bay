import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listCoupons, affiliateReport } from '../../../lib/coupons';
import AdminNav from '../../../components/AdminNav';
import CouponsManager from '../../../components/CouponsManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coupons — Bargain Bay' };

// Coupon codes and their affiliates. Admin-only: a coupon changes what the
// storefront charges, which is not a selling-surface permission.
export default async function CouponsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/coupons');
  if (!isAdmin(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>
          Your account ({session.email}) is not on the admin list. Add it to the
          <code> ADMIN_EMAILS</code> environment variable and redeploy.
        </p>
      </div></div>
    );
  }
  if (!hasDb()) {
    return <div><AdminNav active="coupons" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  }

  // A first visit lands before the tables exist; listCoupons provisions them, but
  // a hard failure here must still render the page rather than a 500.
  const [coupons, affiliates] = await Promise.all([
    listCoupons().catch(() => []),
    affiliateReport().catch(() => [])
  ]);

  return (
    <div>
      <AdminNav active="coupons" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Coupons</h1>
      <CouponsManager initialCoupons={coupons} initialAffiliates={affiliates} />
    </div>
  );
}

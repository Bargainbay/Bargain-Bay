import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getMemberRates } from '../../../lib/member-rates';
import AdminNav from '../../../components/AdminNav';
import PricingManager from '../../../components/PricingManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing — Bargain Bay' };

// What the public and resellers pay, what each unit cost and what we keep. Admin-only: it shows cost
// and sets our margin on every sale.
export default async function PricingPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/pricing');
  if (!isAdmin(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>Your account ({session.email}) is not on the admin list.</p>
      </div></div>
    );
  }
  if (!hasDb()) {
    return <div><AdminNav active="pricing" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  }

  // The API route does the heavy read (every unit, through the checkout price function); fetch it
  // there so the page and the live preview are one code path.
  const cur = await getMemberRates();
  const { GET } = await import('../../api/admin/member-pricing/route');
  const res = await GET();
  const data = res.ok ? await res.json() : null;

  return (
    <div>
      <AdminNav active="pricing" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Pricing</h1>
      {data
        ? <PricingManager initial={{ rates: data.rates, overrides: data.overrides, preview: data.preview }} />
        : <div className="panel">Could not load pricing. Current rates: {JSON.stringify(cur.rates)}</div>}
    </div>
  );
}

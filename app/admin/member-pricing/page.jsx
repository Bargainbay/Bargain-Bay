import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getMemberRates } from '../../../lib/member-rates';
import AdminNav from '../../../components/AdminNav';
import MemberPricingManager from '../../../components/MemberPricingManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Member pricing — Bargain Bay' };

// What resellers pay. Admin-only: it sets our margin on every member sale.
export default async function MemberPricingPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/member-pricing');
  if (!isAdmin(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>Your account ({session.email}) is not on the admin list.</p>
      </div></div>
    );
  }
  if (!hasDb()) {
    return <div><AdminNav active="member-pricing" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  }

  // The API route does the heavy read (every unit, through the checkout price function); fetch it
  // there so the page and the live preview are one code path.
  const cur = await getMemberRates();
  const { GET } = await import('../../api/admin/member-pricing/route');
  const res = await GET();
  const data = res.ok ? await res.json() : null;

  return (
    <div>
      <AdminNav active="member-pricing" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Adjust member pricing</h1>
      {data
        ? <MemberPricingManager initial={{ rates: data.rates, overrides: data.overrides, preview: data.preview }} />
        : <div className="panel">Could not load pricing. Current rates: {JSON.stringify(cur.rates)}</div>}
    </div>
  );
}

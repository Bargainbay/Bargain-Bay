import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listAffiliates } from '../../../lib/affiliates';
import AdminNav from '../../../components/AdminNav';
import AffiliatesManager from '../../../components/AffiliatesManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Affiliates — Bargain Bay' };

// Admin-only: approving an affiliate cuts a code that discounts the storefront, and
// the page records what we pay out.
export default async function AffiliatesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/affiliates');
  if (!isAdmin(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>Your account ({session.email}) is not on the admin list.</p>
      </div></div>
    );
  }
  if (!hasDb()) return <div><AdminNav active="affiliates" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;

  let affiliates = [], error = '';
  try { affiliates = await listAffiliates(); }
  catch (e) { console.error('affiliates load failed', e.message); error = 'Could not load affiliates — if you just deployed, run the schema migration under Operations.'; }

  return (
    <div>
      <AdminNav active="affiliates" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Affiliates</h1>
      {error ? <div className="error-box">{error}</div> : <AffiliatesManager initial={affiliates} />}
    </div>
  );
}

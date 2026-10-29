import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listMembers } from '../../../lib/members';
import AdminNav from '../../../components/AdminNav';
import AdminMembers from '../AdminMembers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Resellers — Bargain Bay' };

// Reseller applications and the approved list. Admin-only: approving one changes what the
// storefront charges that account. The same list also sits in a fold on Operations.
export default async function ResellersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/resellers');
  if (!isAdmin(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>Your account ({session.email}) is not on the admin list.</p>
      </div></div>
    );
  }
  if (!hasDb()) {
    return <div><AdminNav active="resellers" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  }
  let members = [];
  let failed = '';
  try { members = await listMembers(); } catch (e) { failed = e.message; }
  return (
    <div>
      <AdminNav active="resellers" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Resellers</h1>
      {failed
        ? <div className="error-box">Could not load resellers: {failed}</div>
        : <AdminMembers initialMembers={members} heading="Applications" />}
    </div>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import Parts from '../../../components/Parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parts — Bargain Bay' };

// The parts shelf: what we have, what came out of a salvage unit, and who took
// what. Staff-level — finding a part for the machine on the bench is the work.
// Cost and answering a tech's request are admin, and both are enforced in
// app/api/admin/parts, not here.
export default async function PartsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/parts');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  const admin = isAdmin(session);
  return (
    <div>
      <AdminNav active="parts" salesOnly={!admin} />
      {hasDb()
        ? <Parts admin={admin} />
        : <div className="panel">Database not configured — set <code>POSTGRES_URL</code>.</div>}
    </div>
  );
}

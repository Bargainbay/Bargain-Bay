import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import Warehouse from '../../../components/Warehouse';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Warehouse — Bargain Bay' };

// Where every unit is standing. `?unit=` and `?loc=` are what a phone camera
// lands on after scanning one of our stickers (app/w/…).
export default async function WarehousePage({ searchParams }) {
  const sp = await searchParams;
  const unit = String(sp?.unit || '').trim();
  const loc = String(sp?.loc || '').trim();
  const session = await getSession();
  if (!session) {
    const back = `/admin/warehouse${unit ? `?unit=${encodeURIComponent(unit)}` : loc ? `?loc=${encodeURIComponent(loc)}` : ''}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  const admin = isAdmin(session);
  return (
    <div>
      <AdminNav active="warehouse" salesOnly={!admin} />
      {hasDb()
        ? <Warehouse admin={admin} initialUnit={unit} initialSpot={loc} />
        : <div className="panel">Database not configured — set <code>POSTGRES_URL</code>.</div>}
    </div>
  );
}

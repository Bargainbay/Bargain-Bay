import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import Parts from '../../../components/Parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parts — Bargain Bay' };

// The parts shelf, the OFFICE's view: prices, answering a road tech's request,
// and the history. ADMIN only (owner, 2026-09-16). The floor finds, books in and
// takes parts in RS Ops, which reads and writes the same records through
// /api/ops/parts — two floor screens for one shelf is how they drift.
export default async function PartsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/parts');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>
        Parts are the office&apos;s screen here. The warehouse finds and books in parts on the <b>Parts</b> tab in RS Ops.
      </p>
    </div></div>);
  }
  return (
    <div>
      <AdminNav active="parts" />
      {hasDb()
        ? <Parts admin />
        : <div className="panel">Database not configured — set <code>POSTGRES_URL</code>.</div>}
    </div>
  );
}

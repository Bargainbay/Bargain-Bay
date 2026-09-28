import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import SupplierHub from '../../../components/SupplierHub';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Suppliers — Bargain Bay' };

// Everything about who we buy from, on one page.
//
// It used to be two: a "By vendor" tab on /admin/warehouse and a "Suppliers"
// fold on /admin/operations, on different pages, neither aware of the other,
// split by where the data came from rather than by what anybody wanted to know.
//
// STAFF, not admin — a rep answering the phone to a vendor asking about their
// stock is doing a selling job, and that was the whole reason By vendor lived
// on the staff-level warehouse page. What they do NOT get is anything derived
// from cost: spend, payables and unit cost are admin, hidden here AND stripped
// server-side, which is the same rule the invoice form's cost box follows.
export default async function SuppliersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/suppliers');
  if (!isStaff(session)) redirect('/admin');
  const admin = isAdmin(session);

  return (
    <div>
      <AdminNav active="suppliers" salesOnly={!admin} />
      <div className="wrap">
        <h1 style={{ marginBottom: 4, color: 'var(--charcoal)' }}>Suppliers</h1>
        <p className="hint" style={{ marginTop: 0 }}>
          Who we buy from: what they have left with us, who to ring, what we owe them and what we
          have spent.
        </p>
        {hasDb()
          ? <SupplierHub admin={admin} />
          : <div className="panel">Database not configured — set <code>POSTGRES_URL</code>.</div>}
      </div>
    </div>
  );
}

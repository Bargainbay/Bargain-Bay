import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../../lib/auth';
import AdminNav from '../../../../components/AdminNav';
import Suppliers from '../../../../components/Suppliers';
import SupplierSpend from '../../../../components/SupplierSpend';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Supplier spend — Bargain Bay' };

// What we spend, and who we spend it with.
//
// The same Suppliers panel the Operations page carries — one component, so the
// two can never disagree — with the spend-over-time report above it. It has its
// own route because "what did we spend with SecondShop in August" is a question
// somebody goes looking for, and a fold three-quarters of the way down
// Operations is not where they would look.
export default async function SupplierReportPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/reports/suppliers');
  if (!isAdmin(session)) redirect('/admin');
  return (
    <div>
      <AdminNav active="reports" />
      <div className="wrap">
        <h1 style={{ marginBottom: 4, color: 'var(--charcoal)' }}>Suppliers</h1>
        <p className="hint" style={{ marginTop: 0 }}>
          What we have spent with each supplier and when, what is owed, and who we have not
          identified yet. <a href="/admin/reports">← All reports</a>
        </p>
        <SupplierSpend />
        <Suppliers />
      </div>
    </div>
  );
}

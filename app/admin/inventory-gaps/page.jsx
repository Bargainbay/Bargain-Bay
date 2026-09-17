import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import InventoryGaps from '../../../components/InventoryGaps';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock gaps — Bargain Bay' };

// Where the tracker, RS Ops and the sales invoices disagree, and the button that
// makes them agree. Staff: linking a sale to the unit that went out is the same
// invoice work a rep already does. See lib/stock-reconcile.js.
export default async function InventoryGapsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/inventory-gaps');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  return (
    <div>
      <AdminNav active="gaps" salesOnly={!isAdmin(session)} />
      <InventoryGaps />
    </div>
  );
}

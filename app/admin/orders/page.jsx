import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { orderBoard } from '../../../lib/order-board';
import AdminNav from '../../../components/AdminNav';
import AdminOrders from '../AdminOrders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders — Bargain Bay' };

// The orders board, on its own tab.
//
// It lived behind a fold on Operations, which is an admin-only page — so the
// people who actually take the orders could not mark one paid, ready, or out
// for delivery, and could not put a delivery on a driver's day. They were
// selling the appliance and then asking somebody else to press the buttons.
//
// Same component the owner has always used. What a sales associate does NOT get
// is the two ways to undo a sale: cancelling an order (which relists the unit)
// and the edit/refund screen, both of which stay on the admin side of the line
// the rest of the app already draws.
export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/orders');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }

  const admin = isAdmin(session);
  if (!hasDb()) {
    return (
      <div>
        <AdminNav active="orders" salesOnly={!admin} />
        <div className="panel">Database not configured — set <code>POSTGRES_URL</code>.</div>
      </div>
    );
  }

  const { orders, drivers, reps, degraded } = await orderBoard();

  return (
    <div>
      <AdminNav active="orders" salesOnly={!admin} />
      {degraded && (
        <div className="error-box">
          Could not read all of it — if a feature was just deployed, run the schema migration from Operations.
        </div>
      )}
      <AdminOrders initialOrders={orders} drivers={drivers} reps={reps} canVoid={admin} />
    </div>
  );
}

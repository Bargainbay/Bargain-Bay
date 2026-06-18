import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb, query } from '../../../lib/db';
import { getAllOrders } from '../../../lib/orders';
import { listClearanceAdmin } from '../../../lib/clearance';
import { listMembers } from '../../../lib/members';
import { listSold } from '../../../lib/catalog-sync';
import { listDrivers } from '../../../lib/drivers';
import AdminNav from '../../../components/AdminNav';
import AdminOrders from '../AdminOrders';
import AdminTools from '../AdminTools';
import AdminClearance from '../AdminClearance';
import AdminMembers from '../AdminMembers';
import AdminReconcile from '../AdminReconcile';
import AdminDrivers from '../AdminDrivers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operations — Bargain Bay' };

export default async function OperationsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/operations');
  if (!isAdmin(session)) {
    return (
      <div className="narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
          <p style={{ fontSize: 14 }}>
            Your account ({session.email}) is not on the admin list. Add it to the
            <code> ADMIN_EMAILS</code> environment variable and redeploy.
          </p>
        </div>
      </div>
    );
  }
  if (!hasDb()) {
    return <div><AdminNav active="operations" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  }
  let orders = [];
  let reservations = [];
  let clearance = [];
  let members = [];
  let sold = [];
  let drivers = [];
  let needsMigration = false;
  try {
    orders = (await getAllOrders(200)).map((o) => ({
      ...o,
      delivery_date: o.delivery_date ? new Date(o.delivery_date).toISOString().slice(0, 10) : null
    }));
    const { rows } = await query(
      `SELECT r.sku, r.expires_at, r.order_id, o.order_number, o.status AS order_status, o.email
         FROM reservations r LEFT JOIN orders o ON o.id = r.order_id
        ORDER BY r.expires_at DESC`
    );
    reservations = rows.map((r) => ({ ...r, expires_at: r.expires_at.toISOString() }));
  } catch (e) {
    console.error('admin load failed (run migration?)', e.message);
    needsMigration = true;
  }
  try {
    clearance = await listClearanceAdmin();
  } catch (e) {
    console.error('clearance load failed (run migration?)', e.message);
    needsMigration = true;
  }
  try {
    members = await listMembers();
  } catch (e) {
    console.error('members load failed (run migration?)', e.message);
    needsMigration = true;
  }
  try {
    sold = await listSold({ pendingOnly: true });
  } catch (e) {
    console.error('sold reconcile load failed (run migration?)', e.message);
    needsMigration = true;
  }
  try {
    drivers = await listDrivers();
  } catch (e) {
    console.error('drivers load failed (run migration?)', e.message);
    needsMigration = true;
  }
  return (
    <div>
      <AdminNav active="operations" />
      {needsMigration && (
        <div className="error-box">
          Could not read all tables — if you just deployed a new feature, run the schema migration below.
        </div>
      )}
      <AdminOrders initialOrders={orders} drivers={drivers} />
      <AdminReconcile initialItems={sold} />
      <AdminDrivers initialDrivers={drivers} />
      <AdminMembers initialMembers={members} />
      <AdminClearance initialItems={clearance} />
      <AdminTools initialReservations={reservations} />
    </div>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../lib/auth';
import { hasDb, query } from '../../lib/db';
import { getAllOrders } from '../../lib/orders';
import { listClearanceAdmin } from '../../lib/clearance';
import { writebackEnabled } from '../../lib/sheets';
import AdminOrders from './AdminOrders';
import AdminTools from './AdminTools';
import AdminClearance from './AdminClearance';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin — Bargain Bay' };

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
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
    return <div className="narrow"><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  }
  let orders = [];
  let reservations = [];
  let clearance = [];
  let needsMigration = false;
  try {
    orders = await getAllOrders(200);
    const { rows } = await query(
      `SELECT r.sku, r.expires_at, r.order_id, o.order_number, o.status AS order_status, o.email
         FROM reservations r LEFT JOIN orders o ON o.id = r.order_id
        ORDER BY r.expires_at DESC`
    );
    reservations = rows.map((r) => ({ ...r, expires_at: r.expires_at.toISOString() }));
  } catch (e) {
    // Tables probably don't exist yet — show the migrate button instead of crashing.
    console.error('admin load failed (run migration?)', e.message);
    needsMigration = true;
  }
  try {
    clearance = await listClearanceAdmin();
  } catch (e) {
    // clearance table may not exist until the next migration runs
    console.error('clearance load failed (run migration?)', e.message);
    needsMigration = true;
  }
  return (
    <div>
      {needsMigration && (
        <div className="error-box">
          Could not read all tables — if you just deployed the clearance feature, run the schema migration below to create the clearance table.
        </div>
      )}
      <AdminOrders initialOrders={orders} sheetsOn={writebackEnabled()} />
      <AdminClearance initialItems={clearance} />
      <AdminTools initialReservations={reservations} />
    </div>
  );
}

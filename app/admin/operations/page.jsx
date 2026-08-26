import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb, query } from '../../../lib/db';
import { getAllOrders } from '../../../lib/orders';
import { listClearanceAdmin } from '../../../lib/clearance';
import { listMembers } from '../../../lib/members';
import { listSold } from '../../../lib/catalog-sync';
import { listDrivers } from '../../../lib/drivers';
import { podPhotosForOrders } from '../../../lib/pod';
import { listSalvage } from '../../../lib/salvage';
import { listReps } from '../../../lib/reps';
import AdminNav from '../../../components/AdminNav';
import OpsSection from '../../../components/OpsSection';
import OpsFoldBar from '../../../components/OpsFoldBar';
import AdminOrders from '../AdminOrders';
import AdminTools from '../AdminTools';
import AdminClearance from '../AdminClearance';
import AdminMembers from '../AdminMembers';
import AdminReconcile from '../AdminReconcile';
import AdminDrivers from '../AdminDrivers';
import AdminSalvage from '../AdminSalvage';
import AdminIntake from '../AdminIntake';
import PurchaseIntake from '../../../components/PurchaseIntake';
import IntakeQueue from '../../../components/IntakeQueue';
import { listPendingIntake } from '../../../lib/intake-queue';

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
  let salvage = null;
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
  try {
    const podMap = await podPhotosForOrders(orders.map((o) => o.id));
    orders = orders.map((o) => ({ ...o, pod_photo_ids: podMap.get(o.id) || [] }));
  } catch (e) {
    console.error('pod photos load failed (run migration?)', e.message);
    needsMigration = true;
  }
  try {
    salvage = await listSalvage();
  } catch (e) {
    console.error('salvage load failed (run migration?)', e.message);
    needsMigration = true;
  }
  let pendingIntake = [];
  try { pendingIntake = await listPendingIntake(); } catch (e) { console.error('intake queue load failed', e.message); }

  let reps = [];
  try {
    reps = await listReps();
  } catch (e) {
    console.error('reps load failed', e.message);
  }
  return (
    <div>
      <AdminNav active="operations" />
      {needsMigration && (
        <div className="error-box">
          Could not read all tables — if you just deployed a new feature, run the schema migration below.
        </div>
      )}
      {/* Ten tools stacked end to end, and on most days you want one of them.
          Each fold remembers itself, and all of them start shut — a page that
          opens as ten bars is the point. */}
      <OpsFoldBar />
      <OpsSection id="orders" title="Orders" count={orders.length}>
        <AdminOrders initialOrders={orders} drivers={drivers} reps={reps} />
      </OpsSection>

      <OpsSection id="intake-queue" title="Items waiting to be added" count={pendingIntake.length}>
        <IntakeQueue initialPending={pendingIntake} />
      </OpsSection>

      <OpsSection id="purchase-intake" title="Add stock from a purchase invoice">
        <PurchaseIntake />
      </OpsSection>

      <OpsSection id="intake" title="Inventory intake">
        <AdminIntake />
      </OpsSection>

      <OpsSection id="reconcile" title="Tracker reconciliation" count={sold.length}>
        <AdminReconcile initialItems={sold} />
      </OpsSection>

      <OpsSection id="salvage" title="Salvage / parts units" count={salvage?.stats?.availableCount}>
        <AdminSalvage initial={salvage} />
      </OpsSection>

      <OpsSection id="drivers" title="Delivery drivers" count={drivers.length}>
        <AdminDrivers initialDrivers={drivers} />
      </OpsSection>

      <OpsSection id="members" title="Member applications"
        count={members.filter((m) => m.member_status === 'pending').length}>
        <AdminMembers initialMembers={members} />
      </OpsSection>

      <OpsSection id="clearance" title="Clearance" count={clearance.filter((c) => c.active).length}>
        <AdminClearance initialItems={clearance} />
      </OpsSection>

      <OpsSection id="tools" title="Reservations & tools" count={reservations.length}>
        <AdminTools initialReservations={reservations} />
      </OpsSection>
    </div>
  );
}

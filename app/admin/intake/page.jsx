import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import VendorIntake from '../../../components/VendorIntake';
import AdminIntake from '../AdminIntake';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inventory intake — Bargain Bay' };

// Inventory intake, on its own tab.
//
// It lived behind a fold on Operations, which is admin-only — so a rep who took
// in a vendor's drop-off could fill nothing in, attach no photos, and put
// nothing on the site. They took the appliance and then asked somebody else to
// type it up.
//
// What sales get is the VENDOR DROP-OFF form and the sync button: units that
// arrive working, that they saw and photographed themselves. What they do NOT
// get is the "Pending — tested working?" queue. That queue is machines off the
// refurb floor waiting on an inspection, and calling one fit to sell is RS Ops's
// judgement, not a selling decision. Operations keeps its fold for the owner.
export default async function IntakePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/intake');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  const admin = isAdmin(session);
  return (
    <div>
      <AdminNav active="intake" salesOnly={!admin} />
      <VendorIntake />
      {admin && <AdminIntake />}
    </div>
  );
}

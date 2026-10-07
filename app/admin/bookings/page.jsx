import { redirect } from 'next/navigation';
import { dispatchAccess } from '../../../lib/dispatch-access';
import { hasDb } from '../../../lib/db';
import { listBookings } from '../../../lib/bookings';
import AdminNav from '../../../components/AdminNav';
import BookingsAdmin from '../../../components/BookingsAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Booking requests — RS Solutions' };

export default async function BookingsPage() {
  const { session, allowed, full, coordinator } = await dispatchAccess();
  if (!session) redirect('/login?next=/admin/bookings');
  if (!allowed) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  let initial = { bookings: [], counts: {} };
  let error = '';
  if (hasDb()) { try { initial = await listBookings({ status: 'open' }); } catch (e) { error = e.message; } }
  return (
    <div>
      <AdminNav active="bookings" dispatchOnly={coordinator} salesOnly={!full && !coordinator} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 4px' }}>Booking requests</h1>
      <p className="hint" style={{ marginTop: 0 }}>Service calls and moving quotes requested on the website at <b>/book</b>. Nothing here is on the board until you open a service call.</p>
      {error && <p className="error">{error} — has the schema migration been run?</p>}
      <BookingsAdmin initial={initial} />
    </div>
  );
}

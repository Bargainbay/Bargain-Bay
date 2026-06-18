import { redirect } from 'next/navigation';
import { getSession } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { isDriver, driverDeliveries } from '../../lib/drivers';
import { SALES_EMAIL } from '../../lib/constants';
import DriverDeliveries from '../../components/DriverDeliveries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Driver — Bargain Bay', robots: { index: false } };

export default async function DriverPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/driver');
  if (!hasDb()) {
    return <div className="narrow"><div className="panel">Database not configured.</div></div>;
  }
  if (!(await isDriver(session))) {
    return (
      <div className="narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Driver access only</h1>
          <p style={{ fontSize: 14 }}>
            Your account ({session.email}) isn&apos;t set up as a delivery driver. Ask the office to add you, or email {SALES_EMAIL}.
          </p>
        </div>
      </div>
    );
  }

  const deliveries = await driverDeliveries(session.userId);
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ color: 'var(--charcoal)' }}>Your deliveries</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Hi {session.name || 'there'} — here are the stops assigned to you. Tap <b>Start delivery</b> when you head out;
        the customer is notified automatically.
      </p>
      <DriverDeliveries initialDeliveries={deliveries} />
    </div>
  );
}

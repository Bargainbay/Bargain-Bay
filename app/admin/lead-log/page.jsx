import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { leadFunnel, recentLog, knownDetails } from '../../../lib/lead-log';
import AdminNav from '../../../components/AdminNav';
import LeadLog from '../../../components/LeadLog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead log — Bargain Bay' };

// Write down every lead the day it arrives, and see what became of it. STAFF-level: logging a lead is the customer's sale.
export default async function LeadLogPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/lead-log');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  const admin = isAdmin(session);
  if (!hasDb()) {
    return (<div><AdminNav active="lead-log" salesOnly={!admin} /><div className="panel">Database not configured — set <code>POSTGRES_URL</code>.</div></div>);
  }
  const viewer = { email: session.email, name: session.name || '', admin };
  const [funnel, log, details] = await Promise.all([leadFunnel(viewer, { days: 30 }), recentLog(viewer, { days: 14 }), knownDetails(viewer)]);
  return (
    <div>
      <AdminNav active="lead-log" salesOnly={!admin} />
      <LeadLog initial={{ funnel, log, details }} isAdmin={admin} />
    </div>
  );
}

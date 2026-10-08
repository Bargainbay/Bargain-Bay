import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listEmployees, staffShiftReport } from '../../../lib/team-clock';
import { torontoToday } from '../../../lib/constants';
import AdminNav from '../../../components/AdminNav';
import TeamClockAdmin from '../../../components/TeamClockAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team clock — Bargain Bay' };

export default async function TeamClockPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/team-clock');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  const today = torontoToday();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp?.from || '') ? sp.from : new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp?.to || '') ? sp.to : today;
  return (
    <div>
      <AdminNav active="team-clock" />
      {!hasDb() ? <div className="panel">Database not configured.</div>
        : <TeamClockAdmin employees={await listEmployees()} shifts={JSON.parse(JSON.stringify(await staffShiftReport(from, to)))} from={from} to={to} />}
    </div>
  );
}

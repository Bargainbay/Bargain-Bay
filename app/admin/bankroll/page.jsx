import { redirect } from 'next/navigation';
import { getSession, canKeepBooks } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { bankrollSummary } from '../../../lib/bankroll';
import DashboardShell from '../../../components/DashboardShell';
import Bankroll from '../../../components/Bankroll';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bankroll — Bargain Bay' };

export default async function BankrollPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/bankroll');
  if (!(await canKeepBooks(session))) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) doesn&apos;t have access to the books.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="financial"><div className="panel">Database not configured.</div></DashboardShell>);
  let data = null, error = '';
  try { data = await bankrollSummary(sp?.date); } catch (e) { error = 'Could not load the bankroll.'; console.error('bankroll load failed', e.message); }
  return (
    <DashboardShell active="financial">
      {error || !data ? <div className="error-box">{error || 'No data.'}</div> : <Bankroll initial={data} />}
    </DashboardShell>
  );
}

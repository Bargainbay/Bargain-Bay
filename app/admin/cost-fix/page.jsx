import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { zeroCostLines, missingCostLines } from '../../../lib/cost-audit';
import AdminNav from '../../../components/AdminNav';
import CostFix from '../../../components/CostFix';
import CostFillFromTracker from '../../../components/CostFillFromTracker';
import CostByHand from '../../../components/CostByHand';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fix costs — Bargain Bay' };

export default async function CostFixPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/cost-fix');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="daily-pnl" /><div className="panel">Database not configured.</div></div>);
  const a = await zeroCostLines();
  // Reads the tracker, so it can fail on its own without taking the page down.
  const m = await missingCostLines().then((x) => x.summary).catch(() => ({ error: true }));
  return (<div><AdminNav active="daily-pnl" /><CostFix initial={{ summary: a.summary, orderCount: a.orderLines.count }} /><CostFillFromTracker initial={m} /><CostByHand /></div>);
}

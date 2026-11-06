import { redirect } from 'next/navigation';
import { getSession, canKeepBooks } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { EXPENSE_CATEGORIES } from '../../../lib/finance';
import DashboardShell from '../../../components/DashboardShell';
import CategorizeWorkspace from '../../../components/CategorizeWorkspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Categorize — Bargain Bay' };

export default async function CategorizePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/categorize');
  if (!(await canKeepBooks(session))) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) doesn&apos;t have access to the books.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="financial"><div className="panel">Database not configured.</div></DashboardShell>);
  return (
    <DashboardShell active="financial">
      <CategorizeWorkspace categories={EXPENSE_CATEGORIES} />
    </DashboardShell>
  );
}

import { redirect } from 'next/navigation';
import { getSession, isStaff } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import WorkshopBoard from '../../../components/WorkshopBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workshop applications — Bargain Bay' };

export default async function WorkshopAdminPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/workshop');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1><p style={{ fontSize: 14 }}>Workshop applications are for staff.</p></div></div>);
  }
  return (
    <div>
      <AdminNav active="workshop" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Workshop applications</h1>
      <p className="hint" style={{ marginTop: 0 }}>Move each applicant across the board, mark fake ones as junk, and keep a note of every conversation. A green tag means we have spoken to them; amber means we have not.</p>
      <WorkshopBoard />
    </div>
  );
}

import { redirect } from 'next/navigation';
import { dispatchAccess } from '../../lib/dispatch-access';
import { getSession, isAdmin, isSalesRep } from '../../lib/auth';

// The owner portal's home base is the dashboard; /admin just lands there.
//
// Except for the dispatch coordinator, whose portal IS the board: /admin/dashboard
// gates on isStaff, which they are not, so sending them there shows a hire their
// first "not authorized" on their first morning. Nothing is widened here — the
// dashboard still refuses them if they type the URL.
export const dynamic = 'force-dynamic';

export default async function AdminIndex() {
  const { coordinator } = await dispatchAccess();
  // The business-development rep's home is the Sales Hub, not the owner's dashboard.
  const session = await getSession();
  if (session && isSalesRep(session) && !isAdmin(session)) redirect('/sales');
  redirect(coordinator ? '/admin/dispatch' : '/admin/dashboard');
}

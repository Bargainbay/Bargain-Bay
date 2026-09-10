import { redirect } from 'next/navigation';
import { dispatchAccess } from '../../lib/dispatch-access';

// The owner portal's home base is the dashboard; /admin just lands there.
//
// Except for the dispatch coordinator, whose portal IS the board: /admin/dashboard
// gates on isStaff, which they are not, so sending them there shows a hire their
// first "not authorized" on their first morning. Nothing is widened here — the
// dashboard still refuses them if they type the URL.
export const dynamic = 'force-dynamic';

export default async function AdminIndex() {
  const { coordinator } = await dispatchAccess();
  redirect(coordinator ? '/admin/dispatch' : '/admin/dashboard');
}

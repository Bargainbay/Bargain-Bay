import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { dispatchBoard, torontoToday, openTicketCount } from '../../../lib/jobs';
import AdminNav from '../../../components/AdminNav';
import DispatchBoard from '../../../components/DispatchBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatch — Bargain Bay' };

export default async function DispatchPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/dispatch');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(sp?.date || '')) ? String(sp.date) : torontoToday();

  let board = { date, jobs: [], unscheduled: [], drivers: [], clients: [] };
  let openTickets = 0;
  let loadError = '';
  if (hasDb()) {
    try {
      [board, openTickets] = await Promise.all([dispatchBoard(date), openTicketCount()]);
    } catch (e) { loadError = e?.message || 'Could not load the board.'; }
  }

  return (
    <div>
      <AdminNav active="dispatch" salesOnly={!isAdmin(session)} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 4px' }}>Dispatch</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        Every delivery and service call for the day, whichever client it came from. Add one in seconds while
        you&apos;re still on the phone — only the address is required.
      </p>

      {!hasDb() && (
        <div className="error-box">Database isn&apos;t configured (set <code>POSTGRES_URL</code>). Dispatch needs it.</div>
      )}
      {loadError && <div className="error-box">{loadError}</div>}

      <DispatchBoard initial={board} canManageClients={isAdmin(session)} openTickets={openTickets}
        initialView={String(sp?.view || 'board')} />
    </div>
  );
}

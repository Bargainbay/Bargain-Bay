import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listTickets, TICKET_STATUSES, TICKET_OPEN_STATES } from '../../../../lib/jobs';
import AdminNav from '../../../../components/AdminNav';
import TicketActions from '../../../../components/TicketActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Service calls — Bargain Bay' };

// The ticket queue. A ticket is the customer's PROBLEM — a three-trip repair is
// one open call, not three — so this is the number that actually answers "how
// many open service calls do we have".
const TONE = {
  open: 'warn', awaiting_parts: 'warn', scheduled: 'ok',
  resolved: 'ok', closed: 'ok', cancelled: 'sold'
};

export default async function TicketsPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/dispatch/tickets');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }

  const status = TICKET_STATUSES[String(sp?.status || '')] ? String(sp.status) : 'open_states';
  let tickets = [];
  let counts = {};
  let loadError = '';
  if (hasDb()) {
    try { ({ tickets, counts } = await listTickets({ status })); }
    catch (e) { loadError = e?.message || 'Could not load the tickets.'; }
  }
  const openTotal = TICKET_OPEN_STATES.reduce((n, k) => n + (counts[k] || 0), 0);

  return (
    <div>
      <AdminNav active="dispatch" salesOnly={!isAdmin(session)} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 4px' }}>Service calls</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        One ticket per customer problem, however many visits it takes. Oldest first, urgent at the top —
        the <b>days</b> column is how long they&apos;ve been waiting.
      </p>

      {loadError && <div className="error-box">{loadError}</div>}

      <div className="dash-kpis" style={{ marginBottom: 16 }}>
        <div className="kpi-card"><div className="kpi-value">{openTotal}</div><div className="kpi-label">Open right now</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.awaiting_parts || 0}</div><div className="kpi-label">Waiting on parts</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.scheduled || 0}</div><div className="kpi-label">Visit booked</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.resolved || 0}</div><div className="kpi-label">Resolved</div></div>
      </div>

      <div className="panel">
        <form action="/admin/dispatch/tickets" className="inv-search">
          <select name="status" defaultValue={status === 'open_states' ? '' : status}>
            <option value="">Everything still open</option>
            {Object.entries(TICKET_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn accent" type="submit">Show</button>
          <a className="btn" href="/admin/dispatch">← Back to the board</a>
        </form>

        <div className="table-wrap"><table className="admin">
          <thead>
            <tr>
              <th>Ticket</th><th>Customer</th><th>Appliance / problem</th>
              <th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Visits</th>
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>
                {status === 'open_states' ? 'Nothing open — every service call is closed out.' : 'Nothing here.'}
              </td></tr>
            )}
            {tickets.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 700 }}>
                  {t.ticketNumber}
                  {t.priority === 'urgent' && <span className="pill sold" style={{ marginLeft: 4 }}>Urgent</span>}
                  {t.clientName && <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>{t.clientName}</div>}
                </td>
                <td>
                  {t.customerName || '—'}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {[t.address, t.city].filter(Boolean).join(', ')}
                  </div>
                </td>
                <td>
                  {t.appliance || '—'}
                  {t.issue && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.issue}</div>}
                  {t.partsNeeded && <div style={{ fontSize: 12, color: 'var(--danger)' }}>Waiting on: {t.partsNeeded}</div>}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: t.days > 14 ? 700 : 400 }}>
                  {t.days}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {t.visits}
                  {t.lastVisit && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.lastVisit}</div>}
                </td>
                <td><span className={'pill ' + (TONE[t.status] || 'warn')}>{TICKET_STATUSES[t.status]}</span></td>
                <td><TicketActions ticket={t} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

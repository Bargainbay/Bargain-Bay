'use client';
import { useEffect, useState } from 'react';
import TicketActions from './TicketActions';

// The service-call queue, rendered inside the dispatch page rather than on a
// screen of its own. A ticket is the customer's problem — a three-trip repair is
// one open call, not three — so this count is the one that means something.
const TICKET_STATUSES = {
  open: 'Open', awaiting_parts: 'Awaiting parts', scheduled: 'Visit booked',
  resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled'
};
const TONE = {
  open: 'warn', awaiting_parts: 'warn', scheduled: 'ok',
  resolved: 'ok', closed: 'ok', cancelled: 'sold'
};
const OPEN_STATES = ['open', 'awaiting_parts', 'scheduled'];

export default function TicketQueue({ onChanged }) {
  const [status, setStatus] = useState('open_states');
  const [data, setData] = useState({ tickets: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load(next = status) {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`/api/admin/dispatch?view=tickets&status=${encodeURIComponent(next)}`);
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not load the service calls.'); return; }
      setData(d);
    } catch { setErr('Network error — could not load the service calls.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load('open_states'); /* eslint-disable-next-line */ }, []);

  const counts = data.counts || {};
  const openTotal = OPEN_STATES.reduce((n, k) => n + (counts[k] || 0), 0);

  function pick(next) { setStatus(next); load(next); }

  return (
    <div>
      <div className="dash-kpis" style={{ marginBottom: 14 }}>
        <div className="kpi-card"><div className="kpi-value">{openTotal}</div><div className="kpi-label">Open right now</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.awaiting_parts || 0}</div><div className="kpi-label">Waiting on parts</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.scheduled || 0}</div><div className="kpi-label">Visit booked</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.resolved || 0}</div><div className="kpi-label">Resolved</div></div>
      </div>

      <div className="panel">
        <div className="inv-search">
          <select value={status} onChange={(e) => pick(e.target.value)}>
            <option value="open_states">Everything still open</option>
            {Object.entries(TICKET_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="hint" style={{ margin: 0 }}>
            One ticket per customer problem, however many visits it takes. Oldest first, urgent on top.
          </span>
        </div>

        {err && <div className="error-box">{err}</div>}

        <div className="table-wrap"><table className="admin">
          <thead>
            <tr>
              <th>Ticket</th><th>Customer</th><th>Appliance / problem</th>
              <th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Visits</th>
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Loading…</td></tr>}
            {!loading && data.tickets.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>
                {status === 'open_states'
                  ? 'Nothing open — every service call is closed out.'
                  : 'Nothing with that status.'}
              </td></tr>
            )}
            {!loading && data.tickets.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 700 }}>
                  {t.ticketNumber}
                  {t.priority === 'urgent' && <span className="pill sold" style={{ marginLeft: 4 }}>Urgent</span>}
                  {t.clientName && <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>{t.clientName}</div>}
                </td>
                <td>
                  {t.customerName || '—'}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{[t.address, t.city].filter(Boolean).join(', ')}</div>
                </td>
                <td>
                  {t.appliance || '—'}
                  {t.issue && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.issue}</div>}
                  {t.partsNeeded && <div style={{ fontSize: 12, color: 'var(--danger)' }}>Waiting on: {t.partsNeeded}</div>}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: t.days > 14 ? 700 : 400 }}>{t.days}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {t.visits}
                  {t.lastVisit && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.lastVisit}</div>}
                </td>
                <td><span className={'pill ' + (TONE[t.status] || 'warn')}>{TICKET_STATUSES[t.status]}</span></td>
                <td><TicketActions ticket={t} onChanged={() => { load(); onChanged?.(); }} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

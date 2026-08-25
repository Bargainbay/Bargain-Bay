'use client';
import { useState } from 'react';

// Moving a ticket by hand. Most transitions happen on their own when a visit is
// closed out — this is for the cases that don't involve a trip: the part landed,
// the customer went quiet, it turned out not to be our problem.
const NEXT = {
  open: [['awaiting_parts', 'Waiting on parts'], ['resolved', 'Resolve'], ['cancelled', 'Cancel']],
  awaiting_parts: [['open', 'Parts in — reopen'], ['resolved', 'Resolve'], ['cancelled', 'Cancel']],
  scheduled: [['open', 'Back to open'], ['resolved', 'Resolve'], ['cancelled', 'Cancel']],
  resolved: [['closed', 'Close'], ['open', 'Reopen']],
  closed: [['open', 'Reopen']],
  cancelled: [['open', 'Reopen']]
};

export default function TicketActions({ ticket, onChanged }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function move(status, label) {
    if (['cancelled', 'closed'].includes(status) &&
        !window.confirm(`${label} ${ticket.ticketNumber}?`)) return;
    setBusy(status); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ticket_status', ticketId: ticket.id, status })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Failed'); setBusy(''); return; }
      // Inline on the dispatch page — refresh the queue in place rather than
      // reloading the whole screen out from under whatever else is open.
      setBusy('');
      if (onChanged) onChanged(); else window.location.reload();
    } catch {
      setErr('Network error'); setBusy('');
    }
  }

  // Booking another visit on the SAME ticket — the thing that stops a second
  // trip opening a second ticket and inflating the open-call count.
  async function revisit() {
    setBusy('revisit'); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revisit', ticketId: ticket.id })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not book it'); setBusy(''); return; }
      setBusy('');
      window.alert(`${d.jobNumber} added to “To assign” on the board — give it a day and a driver.`);
      if (onChanged) onChanged(); else window.location.reload();
    } catch { setErr('Network error'); setBusy(''); }
  }

  const link = {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    color: 'var(--charcoal)', textDecoration: 'underline', cursor: 'pointer'
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
      {!['closed', 'cancelled'].includes(ticket.status) && (
        <button type="button" style={{ ...link, fontWeight: 600 }} disabled={!!busy} onClick={revisit}
          title="Book another visit on this same ticket">
          {busy === 'revisit' ? '…' : '+ Revisit'}
        </button>
      )}
      {(NEXT[ticket.status] || []).map(([status, label]) => (
        <button key={status} type="button" style={link} disabled={!!busy} onClick={() => move(status, label)}>
          {busy === status ? '…' : label}
        </button>
      ))}
      {ticket.phone && <a href={`tel:${ticket.phone}`} style={{ textDecoration: 'underline' }}>Call</a>}
      {err && <span style={{ color: 'var(--danger)' }}>{err}</span>}
    </span>
  );
}

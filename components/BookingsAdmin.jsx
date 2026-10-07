'use client';
import { useState } from 'react';

const KIND = { service: '🔧 Service call', move: '🚚 Moving quote' };
const ACCESS = { ground: 'ground floor', stairs: 'stairs', elevator: 'elevator' };
const WIN = { any: 'any time', morning: 'morning', afternoon: 'afternoon', evening: 'evening' };
const FILTERS = [['open', 'Open'], ['converted', 'Booked / quoted'], ['closed', 'Closed'], ['all', 'All']];

export default function BookingsAdmin({ initial }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState('open');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(f) {
    setFilter(f);
    const r = await fetch('/api/admin/bookings?status=' + f);
    const j = await r.json();
    if (r.ok) setData(j); else setMsg(j.error || 'Could not load.');
  }
  async function act(payload) {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/admin/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) setMsg(j.error || 'Failed.');
      else { if (j.ticket) setMsg(`Opened service call ${j.ticket} — schedule the visit from the service queue on Dispatch.`); await load(filter); }
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={'btn' + (filter === k ? ' primary' : '')} onClick={() => load(k)}>{l}</button>
        ))}
      </div>
      {msg && <p className="hint" role="status">{msg}</p>}
      {!data.bookings.length && <p className="hint">Nothing here.</p>}
      {data.bookings.map((b) => {
        const d = b.details || {};
        return (
          <div key={b.id} className="panel" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b>{KIND[b.kind]} · {b.ref}{b.status === 'new' ? ' · NEW' : ''}</b>
              <span className="hint">{new Date(b.created_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' })} · {b.status}</span>
            </div>
            <p style={{ margin: '6px 0' }}>
              <b>{b.name}</b> · <a href={'tel:' + b.phone}>{b.phone}</a> · <a href={'mailto:' + b.email}>{b.email}</a>
            </p>
            {b.preferred_day && <p style={{ margin: '4px 0' }}>Wants: <b>{b.preferred_day}</b>, {WIN[b.preferred_window] || 'any time'}{d.flexibleDate ? ' (flexible)' : ''}</p>}
            {b.kind === 'service' ? (<>
              <p style={{ margin: '4px 0' }}>{[d.appliance, d.brand, d.model].filter(Boolean).join(' · ')}{d.urgent ? ' · ⚠ URGENT' : ''}</p>
              <p style={{ margin: '4px 0' }}>{d.issue}</p>
              <p className="hint" style={{ margin: '4px 0' }}>{[b.address, b.city, b.postal].filter(Boolean).join(', ')}</p>
            </>) : (<>
              <p style={{ margin: '4px 0' }}>{d.size}{d.packing ? ' · wants packing help' : ''}</p>
              <p style={{ margin: '4px 0' }}>From: {[b.address, b.city, b.postal].filter(Boolean).join(', ')} ({ACCESS[d.fromAccess]})</p>
              <p style={{ margin: '4px 0' }}>To: {[d.toAddress, d.toCity, d.toPostal].filter(Boolean).join(', ')} ({ACCESS[d.toAccess]})</p>
              {d.bulky && <p style={{ margin: '4px 0' }}>Bulky / special: {d.bulky}</p>}
            </>)}
            {b.note && <p style={{ margin: '4px 0', fontStyle: 'italic' }}>&ldquo;{b.note}&rdquo;</p>}
            {b.ticket_number && <p className="hint">Service call {b.ticket_number} opened.</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {b.kind === 'service' && !b.ticket_id && <button className="btn primary" disabled={busy} onClick={() => act({ action: 'ticket', id: b.id })}>Open service call</button>}
              {b.status === 'new' && <button className="btn" disabled={busy} onClick={() => act({ action: 'status', id: b.id, status: 'contacted' })}>Mark contacted</button>}
              {b.kind === 'move' && b.status !== 'converted' && <button className="btn" disabled={busy} onClick={() => act({ action: 'status', id: b.id, status: 'converted' })}>Mark quoted</button>}
              {b.status !== 'closed' && <button className="btn" disabled={busy} onClick={() => act({ action: 'status', id: b.id, status: 'closed' })}>Close</button>}
              {b.status === 'closed' && <button className="btn" disabled={busy} onClick={() => act({ action: 'status', id: b.id, status: 'new' })}>Reopen</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

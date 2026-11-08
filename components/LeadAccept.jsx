'use client';
import { useState } from 'react';

// Leads the owner assigned that John has not yet acknowledged. Accepting is the
// "I have seen it" tap; the 24-hour clock is stopped by the first real touch.
export default function LeadAccept({ leads }) {
  const [gone, setGone] = useState([]);
  const [busy, setBusy] = useState(false);
  async function accept(id) {
    setBusy(true);
    try {
      const r = await fetch('/api/sales/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', id }) });
      if (r.ok) setGone((g) => [...g, id]);
    } finally { setBusy(false); }
  }
  return (
    <div>
      {leads.filter((l) => !gone.includes(l.id)).map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={() => accept(l.id)}>Accept</button>
          <a href={`/sales/leads?open=${l.id}`} style={{ fontWeight: 700 }}>{l.company || l.contact_name}</a>
          {l.contact_name && l.company && <span>{l.contact_name}</span>}
          {l.phone && <a href={`tel:${l.phone}`}>{l.phone}</a>}
        </div>
      ))}
    </div>
  );
}

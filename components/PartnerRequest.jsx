'use client';
import { useState } from 'react';

// "Ask for a quote or order" for one of the partner's clients. Lands as a follow-up for the sales team.
export default function PartnerRequest({ customerId, clientName }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/partner/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId, note }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setMsg('Sent. We will be in touch.'); setNote(''); setOpen(false); } else setMsg(d.error || 'Could not send.');
    } catch { setMsg('Network error. Please try again.'); } finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 10 }}>
      {!open && <button type="button" className="btn" onClick={() => { setOpen(true); setMsg(''); }}>Ask for a quote or order</button>}
      {open && (
        <div>
          <textarea rows={3} style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={`What does ${clientName || 'your client'} want? Models, quantities, when they need it.`} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send to Bargain Bay'}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className="hint" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

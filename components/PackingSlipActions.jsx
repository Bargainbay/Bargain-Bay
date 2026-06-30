'use client';
import { useState } from 'react';

// Print + email-to-dispatch buttons for the packing slip. Hidden when printing.
export default function PackingSlipActions({ number, dispatchEmail }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function emailDispatch() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/packing-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number })
      });
      const d = await res.json();
      setMsg(res.ok ? `✓ Emailed to ${d.to}` : (d.error || 'Failed to send'));
    } catch {
      setMsg('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 16px' }}>
      <button className="btn primary" onClick={() => window.print()}>🖨 Print / Save PDF</button>
      <button className="btn" disabled={busy} onClick={emailDispatch}>
        {busy ? 'Sending…' : `📧 Email to ${dispatchEmail}`}
      </button>
      <a className="btn" href="/admin/invoices">← Invoices</a>
      {msg && <span style={{ fontSize: 13, color: msg.startsWith('✓') ? 'var(--green, #0f6e56)' : 'var(--danger, #c0392b)' }}>{msg}</span>}
    </div>
  );
}

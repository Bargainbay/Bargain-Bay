'use client';
import { useState } from 'react';

// Inline "how was it paid? → Mark paid" control for an open invoice.
export default function MarkPaidControl({ invoiceId }) {
  // No default — force the owner to pick how it was actually paid (was silently
  // defaulting to e-transfer, so cash sales got mis-recorded).
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function mark() {
    if (!method) { setErr('Pick how it was paid'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, method })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Failed'); return; }
      window.location.reload();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={method} onChange={(e) => { setMethod(e.target.value); setErr(''); }} style={{ padding: '4px 6px', fontSize: 12.5, width: 'auto' }}>
        <option value="">How paid?…</option>
        <option value="cash">Cash</option>
        <option value="etransfer">E-transfer</option>
        <option value="card">Card (manual)</option>
        <option value="cheque">Cheque</option>
        <option value="other">Other</option>
      </select>
      <button className="btn" style={{ padding: '4px 10px', fontSize: 12.5 }} disabled={busy || !method} onClick={mark}>
        {busy ? '…' : 'Mark paid'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}

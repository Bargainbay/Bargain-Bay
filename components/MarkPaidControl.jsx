'use client';
import { useState } from 'react';

// Inline "how was it paid? → Mark paid" control for an open invoice.
export default function MarkPaidControl({ invoiceId }) {
  const [method, setMethod] = useState('etransfer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function mark() {
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
      <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ padding: '4px 6px', fontSize: 12.5, width: 'auto' }}>
        <option value="cash">Cash</option>
        <option value="etransfer">E-transfer</option>
        <option value="card">Card (manual)</option>
        <option value="cheque">Cheque</option>
        <option value="other">Other</option>
      </select>
      <button className="btn" style={{ padding: '4px 10px', fontSize: 12.5 }} disabled={busy} onClick={mark}>
        {busy ? '…' : 'Mark paid'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}

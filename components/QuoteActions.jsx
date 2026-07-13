'use client';
import { useState } from 'react';

// Per-row admin actions for a quote: convert it to an invoice (the moment stock
// is committed) or void it. Open/accepted/expired quotes can be converted.
export default function QuoteActions({ quoteId, status, invoiceUrl, number }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');

  async function act(action) {
    if (action === 'void' && !confirm('Void this quote? It stays on record but can no longer be converted.')) return;
    if (action === 'convert' && !confirm('Convert to an invoice? This emails the customer an e-transfer invoice and will mark its units sold once you mark it paid.')) return;
    setBusy(action); setErr('');
    try {
      const res = await fetch('/api/admin/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId, action })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Action failed.'); return; }
      if (action === 'convert' && d.invoiceUrl) { setMsg(d); return; }
      window.location.reload();
    } catch {
      setErr('Network error.');
    } finally {
      setBusy('');
    }
  }

  if (status === 'converted' && invoiceUrl) {
    return <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Invoiced ↗</a>;
  }
  if (msg) {
    return <a href={msg.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', color: 'var(--ok)' }}>✓ {msg.invoiceNumber} ↗</a>;
  }
  if (!['open', 'accepted', 'expired'].includes(status)) return <span style={{ color: 'var(--muted)' }}>—</span>;

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button className="btn accent" style={{ padding: '5px 10px' }} disabled={!!busy} onClick={() => act('convert')}>
        {busy === 'convert' ? '…' : 'Convert'}
      </button>
      {status === 'open' && number && (
        <a className="btn" style={{ padding: '5px 10px' }} href={`/admin/quotes/${encodeURIComponent(number)}/edit`}>Edit</a>
      )}
      <button className="btn" style={{ padding: '5px 10px' }} disabled={!!busy} onClick={() => act('void')}>
        {busy === 'void' ? '…' : 'Void'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}

'use client';
import { useState } from 'react';

// Per-row invoice actions in the admin list: view, packing slip, and the
// lifecycle actions (void/delete for unpaid, refund for paid).
//   open      → Void · Delete · Packing slip
//   void      → Delete · Packing slip
//   paid      → Refund · Packing slip
//   refunded  → Packing slip
export default function InvoiceActions({ invoice }) {
  const { id, number, status, hostedUrl, orderNumber } = invoice;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function send(method, bodyExtra, confirmMsg, label) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(label); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, ...bodyExtra })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Failed'); setBusy(''); return; }
      window.location.reload();
    } catch {
      setErr('Network error'); setBusy('');
    }
  }

  const link = { textDecoration: 'underline', cursor: 'pointer' };
  const danger = { ...link, color: 'var(--danger, #c0392b)', background: 'none', border: 'none', padding: 0, font: 'inherit' };
  const btn = { ...link, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--charcoal)' };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      {hostedUrl && <a href={hostedUrl} target="_blank" rel="noopener noreferrer" style={link}>View</a>}
      <a href={`/admin/packing-slip/${number}`} target="_blank" rel="noopener noreferrer" style={link}>Packing slip</a>
      {orderNumber && <a href="/admin/operations" style={link} title={`Fulfilment order ${orderNumber}`}>{orderNumber}</a>}

      {status === 'open' && <a href={`/admin/invoices/${number}/edit`} style={link}>Edit</a>}
      {status === 'paid' && !orderNumber && (
        <button style={btn} disabled={!!busy}
          onClick={() => send('PATCH', { action: 'backfill' }, '', 'backfill')}
          title="This paid invoice has no fulfilment order, so it's missing from the dashboard. Create it now.">
          {busy === 'backfill' ? '…' : '+ Add to dashboard'}
        </button>
      )}
      {status === 'open' && (
        <button style={btn} disabled={!!busy}
          onClick={() => send('PATCH', { action: 'void' }, `Void invoice ${number}? It stays on record but is marked void.`, 'void')}>
          {busy === 'void' ? '…' : 'Void'}
        </button>
      )}
      {status === 'paid' && (
        <a href={`/admin/invoices/${number}/refund`} style={{ ...link, color: 'var(--danger, #c0392b)' }}
          title="Refund the whole invoice or just the unit(s) coming back">Refund…</a>
      )}
      {(status === 'open' || status === 'void') && (
        <button style={danger} disabled={!!busy}
          onClick={() => send('DELETE', {}, `Delete invoice ${number} permanently? This can't be undone (use it for invoices created by mistake).`, 'delete')}>
          {busy === 'delete' ? '…' : 'Delete'}
        </button>
      )}
      {err && <span style={{ color: 'var(--danger, #c0392b)' }}>{err}</span>}
    </span>
  );
}

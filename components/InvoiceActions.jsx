'use client';
import { useState } from 'react';

// Per-row invoice actions in the admin list.
//   open      → Edit · Resend · Void · Delete · Packing slip
//   partial   → Edit · Resend (balance-aware) · Void* · Packing slip
//   paid      → Edit · Refund… · Packing slip
//   void      → Delete · Packing slip
//   refunded  → Packing slip
// Edit reaches SETTLED invoices too: a three-month-old sale is exactly the kind
// that needs correcting, and the edit adjusts that sale on its original date
// rather than booking anything new today.
// * Voiding a partly-paid invoice is refused server-side until its deposit is
//   removed or refunded — the button explains that rather than hiding.
export default function InvoiceActions({ invoice }) {
  const { id, number, status, hostedUrl, orderNumber } = invoice;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

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

  // Re-email the invoice (payment request) to the customer. No reload — nothing
  // on the row changes; show a "Sent ✓" in place instead.
  async function resend() {
    setBusy('resend'); setErr(''); setSent(false);
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, action: 'resend' })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Failed'); return; }
      setSent(true);
    } catch {
      setErr('Network error');
    } finally {
      setBusy('');
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

      {(status === 'open' || status === 'partial' || status === 'paid') && (
        <a href={`/admin/invoices/${number}/edit`} style={link}
           title={status === 'paid'
             ? 'Correct this sale — details, lines or prices. Changes adjust the revenue on its original date.'
             : 'Edit this invoice'}>Edit</a>
      )}
      {(status === 'open' || status === 'partial') && (sent
        ? <span style={{ color: 'var(--success, #0f6e56)' }}>Sent ✓</span>
        : <button style={btn} disabled={!!busy}
            onClick={resend}
            title={status === 'partial'
              ? 'Re-email this invoice showing payments to date, asking for the balance owing'
              : 'Re-email this invoice (with e-transfer instructions) to the customer'}>
            {busy === 'resend' ? 'Sending…' : 'Resend email'}
          </button>)}
      {status === 'paid' && !orderNumber && (
        <button style={btn} disabled={!!busy}
          onClick={() => send('PATCH', { action: 'backfill' }, '', 'backfill')}
          title="This paid invoice has no fulfilment order, so it's missing from the dashboard. Create it now.">
          {busy === 'backfill' ? '…' : '+ Add to dashboard'}
        </button>
      )}
      {(status === 'open' || status === 'partial') && (
        <button style={btn} disabled={!!busy}
          title={status === 'partial'
            ? 'This invoice has a deposit against it — remove or refund that payment first, then void.'
            : 'Cancel this invoice. It stays on record, its order is cancelled and the unit goes back on sale.'}
          onClick={() => send('PATCH', { action: 'void' },
            `Void invoice ${number}? It stays on record, its order is cancelled and any held unit goes back on sale.`, 'void')}>
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

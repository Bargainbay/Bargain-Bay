'use client';
import { useState } from 'react';

const todayToronto = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const fmt = (n) => '$' + (Number(n) || 0).toFixed(2);

// Inline payment control for an open / partially-paid invoice.
// Leave the amount blank to mark the whole balance paid (the classic flow);
// type a smaller amount to record a deposit / instalment — the invoice moves to
// "partial" and auto-completes to paid once payments reach the total.
export default function MarkPaidControl({ invoiceId, balance, payments = [] }) {
  // No default — force the owner to pick how it was actually paid (was silently
  // defaulting to e-transfer, so cash sales got mis-recorded).
  const [method, setMethod] = useState('');
  // When the money actually landed. Defaults to today; set it back for a sale
  // that was rung up late — revenue lands on THIS date in the dashboard.
  const [paidDate, setPaidDate] = useState(todayToronto());
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bal = Number(balance) || 0;
  const amt = Number(amount);
  const isPartial = amount !== '' && Number.isFinite(amt) && amt > 0 && bal > 0 && amt < bal - 0.005;

  // Remove a payment recorded in error (double-entry / wrong amount). Only
  // possible while the invoice isn't settled — paid ledgers are locked.
  async function voidPayment(p) {
    if (!window.confirm(`Remove the ${fmt(p.amount)} ${p.method} payment recorded for ${p.date}? The balance owing goes back up — use this only for payments entered by mistake.`)) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void_payment', invoiceId, paymentId: p.id })
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

  async function mark() {
    if (!method) { setErr('Pick how it was paid'); return; }
    if (amount !== '' && (!Number.isFinite(amt) || amt <= 0)) { setErr('Amount must be a positive number'); return; }
    setBusy(true); setErr('');
    try {
      const body = isPartial
        ? { action: 'record_payment', invoiceId, amount: amt, method, paidDate }
        : { invoiceId, method, paidDate };
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
      <input type="date" value={paidDate} max={todayToronto()} onChange={(e) => setPaidDate(e.target.value)}
        title="When the money landed — backdate this for a late-recorded sale so revenue counts on the right day"
        style={{ padding: '3px 5px', fontSize: 12.5, width: 130 }} />
      <input type="number" min="0" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(''); }}
        placeholder={bal > 0 ? `${fmt(bal)} (full)` : 'amount'}
        title="Leave blank to mark the whole balance paid, or enter a smaller amount to record a deposit / partial payment"
        style={{ padding: '3px 5px', fontSize: 12.5, width: 96 }} />
      <button className="btn" style={{ padding: '4px 10px', fontSize: 12.5 }} disabled={busy || !method} onClick={mark}>
        {busy ? '…' : isPartial ? `Record ${fmt(amt)}` : 'Mark paid'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
      {payments.length > 0 && (
        <span style={{ display: 'block', width: '100%', fontSize: 11.5, color: 'var(--muted)' }}>
          {payments.map((p) => (
            <span key={p.id} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
              {fmt(p.amount)} {p.method} · {p.date}
              <button type="button" disabled={busy} onClick={() => voidPayment(p)}
                title="Remove this payment (entered in error)"
                style={{ marginLeft: 3, border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', font: 'inherit', padding: 0 }}>
                ✕
              </button>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

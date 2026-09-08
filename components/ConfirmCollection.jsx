'use client';
import { useState } from 'react';

const fmt = (n) => '$' + (Number(n) || 0).toFixed(2);

// Money a driver reported taking at the door, on the invoice it belongs to.
//
// The invoice is deliberately still OPEN behind this: a delivery being finished
// is not the same fact as the money being in, and it used to be treated as one —
// the phone marked the invoice paid, booked the revenue and emailed a receipt
// before anybody in the office had counted anything. This is where that decision
// actually gets made, and confirming it is what marks the invoice paid.
//
// The amount is editable on purpose: a $500 claim that turns out to be $480 in
// the envelope is confirmed as $480, not argued about a week later.
export default function ConfirmCollection({ rows = [] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [amounts, setAmounts] = useState({});

  if (!rows.length) return null;

  async function post(body) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Failed'); return; }
      window.location.reload();
    } catch {
      setErr('Network error');
    } finally { setBusy(false); }
  }

  function confirm(r) {
    const typed = amounts[r.id];
    const amount = typed === undefined || typed === '' ? r.amount : Number(typed);
    if (!(amount > 0)) { setErr('The amount has to be more than zero'); return; }
    if (!window.confirm(`Confirm ${fmt(amount)} ${r.methodLabel} received? This records the payment against the invoice.`)) return;
    post({ action: 'confirm_collection', collectionId: r.id, amount });
  }

  function reject(r) {
    const note = window.prompt(`${fmt(r.amount)} reported by the driver was not received. What happened? (optional)`, '');
    if (note === null) return;
    post({ action: 'reject_collection', collectionId: r.id, note });
  }

  return (
    <span style={{ display: 'block', marginBottom: 6 }}>
      {rows.map((r) => (
        <span key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <b style={{ whiteSpace: 'nowrap' }}>Driver reports {fmt(r.amount)} {r.methodLabel}</b>
          <input type="number" min="0" step="0.01"
            value={amounts[r.id] ?? String(Number(r.amount).toFixed(2))}
            onChange={(e) => { setAmounts((a) => ({ ...a, [r.id]: e.target.value })); setErr(''); }}
            title="What actually came in — correct it here if the envelope was short"
            style={{ padding: '3px 5px', fontSize: 12.5, width: 88 }} />
          <button className="btn" style={{ padding: '4px 10px', fontSize: 12.5 }} disabled={busy} onClick={() => confirm(r)}>
            {busy ? '…' : 'Confirm received'}
          </button>
          <button type="button" disabled={busy} onClick={() => reject(r)}
            title="The money never reached the office — leave the balance owing"
            style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', font: 'inherit', fontSize: 12 }}>
            not received
          </button>
          <span style={{ color: 'var(--muted)', width: '100%' }}>
            {[r.jobNumber, r.byName, r.collectedAt ? new Date(r.collectedAt).toLocaleDateString('en-CA') : null, r.note]
              .filter(Boolean).join(' · ')}
          </span>
        </span>
      ))}
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}

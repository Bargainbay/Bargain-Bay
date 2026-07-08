'use client';
import { useState } from 'react';

// Per-line refund picker for a PAID invoice. Tick the unit(s)/service(s) coming
// back → each refunded line is relisted on the storefront (units) and its money
// (incl. its HST share) comes off the linked order so the dashboard stays right.
// Ticking everything = a full refund (order cancelled, invoice marked refunded).
export default function RefundItemsControl({ invoice }) {
  const { id, number, hasHst, items } = invoice;
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const refundable = items.filter((it) => !it.refunded);
  const toggle = (itemId) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
    return n;
  });
  const allPicked = refundable.length > 0 && refundable.every((it) => picked.has(it.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(refundable.map((it) => it.id)));

  const base = refundable.filter((it) => picked.has(it.id)).reduce((a, it) => a + it.amount, 0);
  const hst = hasHst ? Math.round(base * 13) / 100 : 0;
  const refundTotal = Math.round((base + hst) * 100) / 100;
  const fmt = (n) => '$' + n.toFixed(2);

  async function submit() {
    if (!picked.size) { setErr('Tick at least one line to refund.'); return; }
    const full = allPicked;
    const msg = full
      ? `Refund ALL remaining lines of ${number} (${fmt(refundTotal)})? This relists the unit(s) and cancels the linked order.`
      : `Refund ${picked.size} line(s) of ${number} for ${fmt(refundTotal)}? The unit(s) are relisted and that amount comes off the recorded sale.`;
    if (!window.confirm(msg)) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, action: 'refund_items', itemIds: [...picked] })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Refund failed.'); return; }
      setDone(d.invoice);
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        ✓ {done.fullyRefunded
          ? <>Invoice <b>{number}</b> fully refunded — unit(s) relisted and the linked order cancelled.</>
          : <>Refunded <b>{done.refundedItems}</b> line(s) of <b>{number}</b> for <b>{fmt(Number(done.refundAmount) || 0)}</b>. Unit(s) relisted; the recorded sale was reduced accordingly.</>}
        <div style={{ marginTop: 10 }}>
          <a className="btn" href="/admin/invoices">← Back to invoices</a>
        </div>
      </div>
    );
  }

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {refundable.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>Every line on this invoice has already been refunded.</p>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={allPicked} onChange={toggleAll} /> Select all
          </label>
          {items.map((it) => (
            <label key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              border: '1px solid var(--line)', borderRadius: 8, marginBottom: 6, fontSize: 14,
              opacity: it.refunded ? 0.55 : 1, cursor: it.refunded ? 'default' : 'pointer'
            }}>
              <input type="checkbox" style={{ width: 'auto' }} disabled={it.refunded}
                checked={picked.has(it.id)} onChange={() => toggle(it.id)} />
              <span style={{ flex: 1, textDecoration: it.refunded ? 'line-through' : 'none' }}>
                {it.description}
                {it.sku && <span style={{ color: 'var(--muted)', fontSize: 12 }}> ({it.sku})</span>}
                {it.kind === 'service' && <span className="pill" style={{ fontSize: 11, marginLeft: 6 }}>Service</span>}
                {it.refunded && <span className="pill sold" style={{ fontSize: 11, marginLeft: 6 }}>Refunded</span>}
              </span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(it.amount)}</span>
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>
              Refund {fmt(base)}{hasHst ? ` + HST ${fmt(hst)}` : ''} · <b style={{ color: 'var(--charcoal)' }}>{fmt(refundTotal)}</b>
              {allPicked && <span> — this refunds the whole invoice</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <a className="btn" href="/admin/invoices">Cancel</a>
              <button className="btn accent" disabled={busy || !picked.size} onClick={submit}>
                {busy ? 'Refunding…' : (allPicked ? 'Refund entire invoice' : `Refund ${picked.size || ''} selected`)}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

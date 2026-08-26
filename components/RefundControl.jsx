'use client';
import { useState } from 'react';
import { RESTOCKING_FEE_PCT, MAX_RESTOCKING_FEE_PCT } from '../lib/constants';

// The refund console for one invoice. Two ways money goes back, because they are
// genuinely different events and conflating them is how stock goes wrong:
//
//  * "Items came back" — tick the unit(s) being returned. Each is relisted on the
//    storefront and its money comes off the linked order. Optionally we keep a
//    restocking fee (the published 20% on a change-of-mind return), which stays
//    booked as revenue instead of being cancelled away with the rest of the sale.
//  * "Refund an amount" — a price adjustment, a goodwill credit, a deposit handed
//    back. Money only: nothing is relisted, because nothing came back.
export default function RefundControl({ invoice }) {
  const { id, number, hasHst, items, refundable, status, refunds = [] } = invoice;
  const canReturnItems = status === 'paid';

  const [tab, setTab] = useState(canReturnItems ? 'items' : 'amount');
  const [picked, setPicked] = useState(() => new Set());
  const [restock, setRestock] = useState(false);
  const [pct, setPct] = useState(String(RESTOCKING_FEE_PCT));
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const fmt = (n) => '$' + (Number(n) || 0).toFixed(2);
  const r2 = (n) => Math.round(n * 100) / 100;

  const refundableItems = items.filter((it) => !it.refunded);
  const toggle = (itemId) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
    return n;
  });
  const allPicked = refundableItems.length > 0 && refundableItems.every((it) => picked.has(it.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(refundableItems.map((it) => it.id)));

  // Mirrors splitRestocking() in lib/invoices.js — HST follows the money on both
  // halves, because a restocking fee is itself a taxable supply in Ontario.
  const feePct = restock ? Math.min(MAX_RESTOCKING_FEE_PCT, Math.max(0, Number(pct) || 0)) : 0;
  const base = r2(refundableItems.filter((it) => picked.has(it.id)).reduce((a, it) => a + it.amount, 0));
  const keptBase = r2(base * (feePct / 100));
  const refundBase = r2(base - keptBase);
  const refundHst = hasHst ? r2(refundBase * 0.13) : 0;
  const itemsRefund = r2(refundBase + refundHst);
  const feeKept = r2(keptBase + (hasHst ? r2(keptBase * 0.13) : 0));

  const amt = r2(Number(amount) || 0);

  async function post(body, confirmMsg) {
    if (!window.confirm(confirmMsg)) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, reason: reason.trim(), ...body })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Refund failed.'); return; }
      setDone({ ...d.invoice, mode: body.action });
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  function submitItems() {
    if (!picked.size) { setErr('Tick at least one line to refund.'); return; }
    const feeLine = feeKept ? ` We keep ${fmt(feeKept)} as a ${feePct}% restocking fee.` : '';
    const msg = allPicked
      ? `Refund ${fmt(itemsRefund)} on ${number} and relist every remaining unit?${feeLine}`
      : `Refund ${picked.size} line(s) of ${number} for ${fmt(itemsRefund)}? The unit(s) are relisted and that money comes off the recorded sale.${feeLine}`;
    post({ action: 'refund_items', itemIds: [...picked], restockingPct: feePct }, msg);
  }

  function submitAmount() {
    if (!(amt > 0)) { setErr('Enter a refund amount greater than zero.'); return; }
    if (amt > refundable + 0.005) { setErr(`Only ${fmt(refundable)} is still refundable on ${number}.`); return; }
    post({ action: 'refund_amount', amount: amt },
      `Refund ${fmt(amt)} against ${number}? This returns money only — no unit is relisted.`);
  }

  if (done) {
    return (
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        {done.mode === 'refund_amount' ? (
          <>✓ Refunded <b>{fmt(done.refundAmount)}</b> against <b>{number}</b>.
            {done.orderAdjusted ? ' The recorded sale was reduced by the same amount, in its original month.' : ''}
            {' '}No unit was relisted — if the appliance came back, run an item return as well.
            {done.status === 'refunded' && <> This invoice is now fully refunded.</>}
          </>
        ) : done.fullyRefunded ? (
          <>✓ Invoice <b>{number}</b> refunded in full — <b>{fmt(done.refundAmount)}</b> back, unit(s) relisted
            {done.feeKept ? <>, and <b>{fmt(done.feeKept)}</b> kept as a {done.restockingPct}% restocking fee.</> : ' and the linked order cancelled.'}
          </>
        ) : (
          <>✓ Refunded <b>{done.refundedItems}</b> line(s) of <b>{number}</b> for <b>{fmt(done.refundAmount)}</b>. Unit(s) relisted; the recorded sale was reduced accordingly.
            {done.feeKept ? <> <b>{fmt(done.feeKept)}</b> was kept as a {done.restockingPct}% restocking fee.</> : null}
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <a className="btn" href="/admin/invoices">← Back to invoices</a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="tab-row" style={{ marginBottom: 14 }}>
        <button type="button" className={'tab-btn' + (tab === 'items' ? ' is-on' : '')}
          disabled={!canReturnItems} onClick={() => { setTab('items'); setErr(''); }}>
          Items came back
        </button>
        <button type="button" className={'tab-btn' + (tab === 'amount' ? ' is-on' : '')}
          onClick={() => { setTab('amount'); setErr(''); }}>
          Refund an amount
        </button>
      </div>

      {err && <div className="error-box">{err}</div>}

      {tab === 'items' ? (
        refundableItems.length === 0 ? (
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

            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={restock}
                  onChange={(e) => setRestock(e.target.checked)} />
                <span>Keep a restocking fee <span style={{ color: 'var(--muted)' }}>(change of mind — the fault is on their side)</span></span>
              </label>
              {restock && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <input type="number" min="0" max={MAX_RESTOCKING_FEE_PCT} step="1" value={pct}
                    onChange={(e) => setPct(e.target.value)} aria-label="Restocking fee percent"
                    style={{ width: 90, fontSize: 16 }} />
                  <span style={{ fontSize: 14, color: 'var(--muted)' }}>
                    % of the returned value — we keep <b style={{ color: 'var(--charcoal)' }}>{fmt(feeKept)}</b>, it stays on the books as revenue.
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                Returned {fmt(base)}
                {feeKept ? <> − fee {fmt(keptBase)}</> : null}
                {hasHst ? ` + HST ${fmt(refundHst)}` : ''} · refund <b style={{ color: 'var(--charcoal)' }}>{fmt(itemsRefund)}</b>
                {allPicked && <span> — this refunds everything left on the invoice</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="btn" href="/admin/invoices">Cancel</a>
                <button className="btn accent" disabled={busy || !picked.size} onClick={submitItems}>
                  {busy ? 'Refunding…' : (allPicked ? 'Refund entire invoice' : `Refund ${picked.size || ''} selected`)}
                </button>
              </div>
            </div>
          </>
        )
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Returns money without moving stock — a price adjustment after the fact, a goodwill credit, a
            deposit handed back. The recorded sale shrinks by this amount <b>in its original month</b>.
            If the appliance itself came back, use <b>Items came back</b> instead so it is relisted.
          </p>
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="rf-amt">Amount to refund (CAD)</label>
            <input id="rf-amt" type="number" min="0" step="0.01" max={refundable} value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ fontSize: 16 }} />
            <div className="hint">
              {refundable > 0
                ? <>Up to <b>{fmt(refundable)}</b> — what was collected and not yet returned.{' '}
                    <button type="button" className="linkish" onClick={() => setAmount(String(refundable.toFixed(2)))}>Refund it all</button></>
                : 'Everything collected on this invoice has already been refunded.'}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <a className="btn" href="/admin/invoices">Cancel</a>
            <button className="btn accent" disabled={busy || !(amt > 0) || refundable <= 0} onClick={submitAmount}>
              {busy ? 'Refunding…' : `Refund ${amt > 0 ? fmt(amt) : ''}`}
            </button>
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="rf-reason">Reason <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional — recorded against the refund)</span></label>
        <input id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Changed their mind / damaged in transit / price matched…" maxLength={300} style={{ fontSize: 16 }} />
      </div>

      {refunds.length > 0 && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: 'var(--charcoal)' }}>Already refunded</h3>
          {refunds.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '4px 0', color: 'var(--muted)' }}>
              <span>
                {r.at ? new Date(r.at).toLocaleDateString('en-CA') : ''} · {KIND_LABELS[r.kind] || r.kind}
                {r.restockingFee > 0 ? ` · kept ${fmt(r.restockingFee)} fee (${r.restockingPct}%)` : ''}
                {r.reason ? ` · ${r.reason}` : ''}
              </span>
              <b style={{ whiteSpace: 'nowrap', color: 'var(--charcoal)' }}>−{fmt(r.amount)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABELS = { items: 'Items returned', amount: 'Amount refunded', full: 'Full refund' };

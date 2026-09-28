'use client';
import { useEffect, useState } from 'react';
import PurchaseOrderForm from './PurchaseOrderForm';

// What we have ordered, and what is late.
//
// The late list leads, because it is the only part anybody has to act on today.
// Everything else on this screen is a record; that part is a job.
const money = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '—');

function Receive({ po, onDone }) {
  const [qty, setQty] = useState(() => Object.fromEntries(po.lines.map((l) => [l.id, 0])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const taking = Object.values(qty).reduce((a, n) => a + (Number(n) || 0), 0);

  async function submit() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/purchase-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'receive', id: po.id,
          lines: Object.entries(qty).filter(([, n]) => Number(n) > 0).map(([lineId, n]) => ({ lineId: Number(lineId), qty: Number(n) }))
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); return; }
      onDone(d);
    } catch { setErr('Network error.'); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {err && <div className="error-box">{err}</div>}
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>In</th><th style={{ textAlign: 'right' }}>Receiving now</th></tr></thead>
        <tbody>
          {po.lines.map((l) => {
            const left = Math.max(0, l.qty - l.qty_received);
            return (
              <tr key={l.id}>
                <td>{[l.make, l.model].filter(Boolean).join(' ') || l.description}
                  <div className="hint" style={{ fontSize: 12 }}>{l.category}{l.unit_cost ? ` · ${money(l.unit_cost)} each` : ''}</div></td>
                <td style={{ textAlign: 'right' }}>{l.qty}</td>
                <td style={{ textAlign: 'right' }}>{l.qty_received}</td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" min={0} style={{ width: 70, textAlign: 'right' }}
                         value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                  {left > 0 && <button className="btn" style={{ fontSize: 11, marginLeft: 6 }}
                                       onClick={() => setQty({ ...qty, [l.id]: left })}>all {left}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="hint" style={{ marginTop: 6 }}>
        Receiving books these onto the tracker <b>with their cost from this order</b>, so they do not
        become &ldquo;NEEDS INVOICE&rdquo; rows waiting on a fill request. More than ordered is allowed —
        suppliers over-ship, and an appliance that is here should be booked in.
      </p>
      <button className="btn primary" disabled={busy || !taking} onClick={submit}>
        {busy ? 'Booking in…' : `Receive ${taking || ''}`.trim()}
      </button>
    </div>
  );
}

// Money the books do not know about, in both directions.
function Gaps() {
  const [g, setG] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch('/api/admin/purchase-orders?view=gaps').then((r) => r.json()).then(setG).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!g || (!g.unbilled?.length && !g.unmatched?.length)) return null;

  async function link(invoiceId, poId) {
    setBusy(true);
    try {
      await fetch('/api/admin/purchase-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', invoiceId, poId })
      });
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 16 }}>
      {g.unbilled?.length > 0 && (
        <>
          <h3 style={{ fontSize: 13.5, margin: '0 0 4px', color: '#b3261e' }}>
            Arrived, nobody billed us ({g.unbilled.length} · {money(g.unbilledValue)})
          </h3>
          <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
            Their cost is not in the books and no HST has been reclaimed on them. Chase the supplier
            for an invoice, or upload it if it is sitting in the inbox.
          </p>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Supplier</th><th>Order</th><th style={{ textAlign: 'right' }}>Units in</th><th style={{ textAlign: 'right' }}>Cost</th></tr></thead>
            <tbody>
              {g.unbilled.map((r) => (
                <tr key={r.id}><td>{r.vendor}</td><td>{r.order_number || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.received}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.value)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {g.unmatched?.length > 0 && (
        <>
          <h3 style={{ fontSize: 13.5, margin: '14px 0 4px' }}>
            Invoices with no order ({g.unmatched.length} · {money(g.unmatchedValue)})
          </h3>
          <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
            Either somebody bought outside the process, or an order was never raised. Link one to its
            order and the three-way check starts working for it.
          </p>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Supplier</th><th>Invoice</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Subtotal</th><th /></tr></thead>
            <tbody>
              {g.unmatched.map((r) => <UnmatchedRow key={r.id} inv={r} onLink={link} busy={busy} />)}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

function UnmatchedRow({ inv, onLink, busy }) {
  const [opts, setOpts] = useState(null);
  return (
    <tr>
      <td>{inv.vendor || '—'}</td>
      <td>{inv.invoice_number || <span className="hint">no number</span>}</td>
      <td style={{ textAlign: 'right' }}>{inv.units}</td>
      <td style={{ textAlign: 'right' }}>{money(inv.subtotal)}</td>
      <td style={{ textAlign: 'right' }}>
        {!opts && (
          <button className="btn" style={{ fontSize: 12 }} disabled={busy}
                  onClick={() => fetch(`/api/admin/purchase-orders?suggest=${inv.id}`)
                    .then((r) => r.json()).then((d) => setOpts(d.orders || []))}>
            Find its order
          </button>
        )}
        {opts && !opts.length && <span className="hint" style={{ fontSize: 12 }}>no open order for this supplier</span>}
        {opts?.map((o) => (
          <button key={o.id} className="btn" style={{ fontSize: 12, marginLeft: 6 }} disabled={busy}
                  onClick={() => onLink(inv.id, o.id)}>
            {o.order_number || `#${o.id}`}{o.exact ? ' ✓' : ''}
          </button>
        ))}
      </td>
    </tr>
  );
}

export default function PurchaseOrders() {
  const [s, setS] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [po, setPo] = useState(null);
  const [msg, setMsg] = useState('');
  const [raising, setRaising] = useState(false);

  const load = () => fetch('/api/admin/purchase-orders?view=summary')
    .then((r) => r.json()).then(setS).catch(() => setS(null));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!openId) { setPo(null); return; }
    fetch(`/api/admin/purchase-orders?id=${openId}`).then((r) => r.json()).then((d) => setPo(d.po)).catch(() => {});
  }, [openId]);

  if (!s) return null;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>On order</h2>
        {/* This button did not exist, and neither did anything else that called
            createPurchaseOrder — so this panel rendered empty forever and
            receiving had nothing to receive against. */}
        <button className="btn primary" style={{ marginLeft: 'auto', fontSize: 13 }}
                onClick={() => setRaising((v) => !v)}>
          {raising ? 'Close' : '+ Raise a purchase order'}
        </button>
      </div>

      {msg && <div className="notice-box">{msg}</div>}

      {raising && (
        <PurchaseOrderForm
          onCancel={() => setRaising(false)}
          onCreated={() => { setRaising(false); setMsg('Purchase order raised.'); load(); }} />
      )}

      {!s.orders && !raising && (
        <p className="hint" style={{ margin: 0 }}>
          Nothing on order. Raise one and the appliances exist in the system from the moment they
          are ordered — so they can be chased, and they arrive priced.
        </p>
      )}

      {s.orders > 0 && (
        <>
          <div className="dash-kpis" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="kpi-label">Orders open</div>
              <div className="kpi-value">{s.orders}</div><div className="kpi-sub">{s.units} units owed</div></div>
            <div className="kpi"><div className="kpi-label">Late</div>
              <div className="kpi-value" style={{ color: s.late ? '#b3261e' : undefined }}>{s.late}</div>
              <div className="kpi-sub">{s.lateUnits} units</div></div>
          </div>

          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Supplier</th><th>Order</th><th>Due</th><th style={{ textAlign: 'right' }}>Owed</th><th /></tr></thead>
            <tbody>
              {/* Late first — the only part anybody has to act on today. */}
              {[...s.list].sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0)).map((p) => (
                <tr key={p.id} style={p.late ? { background: '#fdf3f2' } : undefined}>
                  <td>{p.vendor}</td>
                  <td>{p.order_number || <span className="hint">no number</span>}</td>
                  <td>{fmt(p.expected_on)}{p.late && <b style={{ color: '#b3261e', marginLeft: 6 }}>late</b>}</td>
                  <td style={{ textAlign: 'right' }}>{p.outstanding} of {p.ordered}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" style={{ fontSize: 12.5 }}
                            onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                      {openId === p.id ? 'Close' : 'Receive'}
                    </button>
                    <button className="btn" style={{ fontSize: 12.5, marginLeft: 6 }}
                            title="It is not coming. Cancelling leaves anything already received alone."
                            onClick={async () => {
                              if (!window.confirm(`Cancel the ${p.vendor} order? Anything already received stays booked in.`)) return;
                              await fetch('/api/admin/purchase-orders', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'cancel', id: p.id })
                              });
                              setMsg('Order cancelled.'); setOpenId(null); load();
                            }}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      <Gaps />

      {po && (
        <div className="panel" style={{ marginTop: 12 }}>
          <b>{po.vendor}</b> {po.order_number ? `· ${po.order_number}` : ''}
          <Receive po={po} onDone={(d) => {
            setMsg(`Booked in ${d.received} unit(s)${d.skus?.length ? ` — ${d.skus.join(', ')}` : ''}.`);
            setOpenId(null); load();
          }} />
        </div>
      )}
    </div>
  );
}

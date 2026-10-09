'use client';
import { useEffect, useState } from 'react';
import { insuranceCents } from '../lib/marketplace-rules';

const cents = (n) => `$${(Number(n || 0) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LABEL = { awaiting_accept: 'Accept it', accepted: 'Accepted — get it ready', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' };

// Hours left to a deadline, with the same three states the server judges: green, amber under six hours, red when overdue.
function Clock({ label, deadline, done, now }) {
  if (done) return <div style={{ fontSize: 13 }}>{label}: <span className="pill ok">done</span></div>;
  const left = (new Date(deadline) - now) / 3600000;
  const tone = left < 0 ? 'warn' : left < 6 ? 'warn' : 'ok';
  const text = left < 0 ? `OVERDUE by ${Math.abs(left).toFixed(1)} h` : `${Math.floor(left)} h ${Math.round((left % 1) * 60)} m left`;
  return <div style={{ fontSize: 13 }}>{label}: <span className={`pill ${tone}`} style={left < 0 ? { background: 'var(--dangerbg)', color: 'var(--danger)' } : undefined}>{text}</span></div>;
}

export default function VendorOrders({ initial, serverNow, cancelReasons, carriers, rules }) {
  const [orders, setOrders] = useState(initial);
  // The countdown ticks in the browser, but every deadline is judged on the server from its own clock.
  const skew = new Date(serverNow) - Date.now();
  const [now, setNow] = useState(() => new Date(Date.now() + skew));
  useEffect(() => { const t = setInterval(() => setNow(new Date(Date.now() + skew)), 30000); return () => clearInterval(t); }, [skew]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({});
  const f = (id, k) => form[id]?.[k] || '';
  const setF = (id, k, v) => setForm((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));

  async function refresh() {
    const d = await (await fetch('/api/vendor/orders')).json();
    if (d.orders) setOrders(d.orders);
  }
  async function act(body, ok) {
    setBusy(true); setErr(''); setNote('');
    try {
      const res = await fetch('/api/vendor/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); await refresh(); return; }
      setNote(ok); await refresh();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  const open = orders.filter((o) => ['awaiting_accept', 'accepted', 'ready'].includes(o.status));
  const done = orders.filter((o) => !open.includes(o));

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {note && <div className="panel" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>{note}</div>}
      <div className="panel" style={{ fontSize: 14 }}>
        When a customer&rsquo;s payment is confirmed, you have <b>{rules.acceptHours} hours to accept</b> and <b>{rules.readyHours} hours in total to have it ready</b>
        (or tracking submitted, if you ship it). Missing either deadline, or cancelling, is a strike.
      </div>

      <h2 style={{ fontSize: 17 }}>Open orders ({open.length})</h2>
      {open.length === 0 && <div className="panel" style={{ marginBottom: 16 }}>Nothing waiting on you.</div>}
      {open.map((o) => (
        <div key={o.id} className="panel">
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong>{o.orderNumber}</strong> <span className="pill">{LABEL[o.status]}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Lane {o.lane} · {cents(o.itemCents)}</span>
          </div>
          <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 14 }}>{o.items.map((i) => <li key={i.sku}>{i.title} <span style={{ color: 'var(--muted)' }}>({i.sku})</span></li>)}</ul>
          <Clock label="Accept within 24 h" deadline={o.acceptBy} done={o.acceptedAt} now={now} />
          <Clock label="Ready within 72 h" deadline={o.readyBy} done={o.readyAt} now={now} />

          {o.status === 'awaiting_accept' && (
            <div style={{ marginTop: 12 }}>
              {o.lane !== 'C' ? (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 14, marginBottom: 4 }}><b>Shipment insurance</b> — Bargain Bay delivers this unit. Choose one:</div>
                  <label style={{ display: 'block', fontSize: 14 }}><input type="radio" name={`ins${o.id}`} checked={f(o.id, 'ins') === 'insured'} onChange={() => setF(o.id, 'ins', 'insured')} />{' '}
                    Insure it — {cents(insuranceCents(o.itemCents))} ({rules.insuranceBps / 100}% of the price), taken from your payout. Damage in our transit is covered.</label>
                  <label style={{ display: 'block', fontSize: 14 }}><input type="radio" name={`ins${o.id}`} checked={f(o.id, 'ins') === 'declined'} onChange={() => setF(o.id, 'ins', 'declined')} />{' '}
                    Decline insurance — you accept the risk of damage in our transit (the customer is made whole first, then it is charged to you).</label>
                </div>
              ) : <p style={{ fontSize: 13, color: 'var(--muted)' }}>You ship this one yourself, so you will add the carrier and tracking number when it is ready.</p>}
              <button className="btn primary" disabled={busy || (o.lane !== 'C' && !f(o.id, 'ins'))}
                onClick={() => act({ action: 'accept', id: o.id, insurance: f(o.id, 'ins') || undefined }, `Accepted ${o.orderNumber}.`)}>Accept order</button>
            </div>
          )}

          {o.status === 'accepted' && (
            <div style={{ marginTop: 12 }}>
              {o.lane === 'C' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select value={f(o.id, 'carrier')} onChange={(e) => setF(o.id, 'carrier', e.target.value)} style={{ width: 'auto' }}>
                    <option value="">Carrier…</option>{carriers.map((c) => <option key={c}>{c}</option>)}</select>
                  <input placeholder="Tracking number" value={f(o.id, 'trk')} onChange={(e) => setF(o.id, 'trk', e.target.value)} style={{ width: 220 }} />
                  <button className="btn primary" disabled={busy || !f(o.id, 'carrier') || !f(o.id, 'trk')}
                    onClick={() => act({ action: 'ready', id: o.id, carrier: f(o.id, 'carrier'), trackingNumber: f(o.id, 'trk') }, 'Tracking submitted.')}>Submit tracking</button>
                </div>
              ) : (
                <button className="btn primary" disabled={busy} onClick={() => act({ action: 'ready', id: o.id }, 'Marked ready for collection.')}>
                  Packed and ready for collection</button>
              )}
              {o.lane !== 'C' && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>Upright fridges, doors taped, cords bundled, loose parts boxed — see the packing standards.</p>}
            </div>
          )}

          {o.status === 'ready' && o.lane === 'C' && <p style={{ fontSize: 14, marginBottom: 0 }}>Shipped with {o.carrier}, tracking {o.trackingNumber}.</p>}
          {o.status === 'ready' && o.lane !== 'C' && <p style={{ fontSize: 14, marginBottom: 0 }}>{o.collectedAt
            ? <>Our crew collected it on {new Date(o.collectedAt).toISOString().slice(0, 10)}. Insurance: {o.insuranceChoice}.</>
            : o.lane === 'B' ? <>Ready. We have booked a crew to collect it; they will check the model and serial against your listing. Insurance: {o.insuranceChoice}.</>
              : <>Ready. We will receive it. Insurance: {o.insuranceChoice}.</>}</p>}

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>Cancel this order</summary>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <select value={f(o.id, 'why')} onChange={(e) => setF(o.id, 'why', e.target.value)} style={{ width: 'auto' }}>
                <option value="">Reason…</option>{Object.entries(cancelReasons).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
              <input placeholder="Note (required for Other)" value={f(o.id, 'cnote')} onChange={(e) => setF(o.id, 'cnote', e.target.value)} style={{ width: 220 }} />
              <button className="btn danger" disabled={busy || !f(o.id, 'why')}
                onClick={() => confirm('Cancel this order? The customer is refunded in full and this counts as a strike on your account.') &&
                  act({ action: 'cancel', id: o.id, reasonCode: f(o.id, 'why'), note: f(o.id, 'cnote') }, 'Order cancelled and the customer refunded.')}>Cancel and refund</button>
            </div>
          </details>
        </div>
      ))}

      <h2 style={{ fontSize: 17 }}>Past orders</h2>
      <div className="panel"><div className="table-wrap"><table className="admin"><thead><tr><th>Order</th><th>Lane</th><th>Amount</th><th>Status</th><th>Detail</th></tr></thead><tbody>
        {done.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>None yet.</td></tr>}
        {done.map((o) => <tr key={o.id}><td>{o.orderNumber}</td><td>{o.lane}</td><td>{cents(o.itemCents)}</td><td>{LABEL[o.status]}</td>
          <td>{o.status === 'cancelled' ? `${o.cancelCode?.replace('_', ' ')}${o.cancelNote ? ` — ${o.cancelNote}` : ''}` : o.deliveredAt ? `delivered ${new Date(o.deliveredAt).toISOString().slice(0, 10)}` : ''}</td></tr>)}
      </tbody></table></div></div>
    </div>
  );
}

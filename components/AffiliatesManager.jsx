'use client';
// Admin: applications to approve, and for each approved affiliate what they are
// owed and a place to record the e-transfer once it has been sent.
import { useState } from 'react';

const $ = (v) => `$${Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE = { waiting: 'not delivered yet', hold: 'in return window', payable: 'payable', void: 'void' };

export default function AffiliatesManager({ initial }) {
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(0);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({});
  const f = (id, k) => form[id]?.[k] ?? '';
  const setF = (id, k, v) => setForm((x) => ({ ...x, [id]: { ...(x[id] || {}), [k]: v } }));

  async function reload() {
    const r = await fetch('/api/admin/affiliates', { cache: 'no-store' }).then((x) => x.json());
    if (r.affiliates) setList(r.affiliates);
  }
  async function act(id, body, done) {
    setBusy(id); setMsg('');
    try {
      const r = await fetch('/api/admin/affiliates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || 'Failed.'); return; }
      setMsg(done || 'Saved.');
      await reload();
      if (open === id) setDetail(await fetch(`/api/admin/affiliates?id=${id}`, { cache: 'no-store' }).then((x) => x.json()));
    } catch { setMsg('Network error.'); } finally { setBusy(0); }
  }
  async function toggle(id) {
    if (open === id) { setOpen(0); setDetail(null); return; }
    setOpen(id); setDetail(null);
    setDetail(await fetch(`/api/admin/affiliates?id=${id}`, { cache: 'no-store' }).then((x) => x.json()));
  }

  const pending = list.filter((a) => a.status === 'pending');
  const rest = list.filter((a) => a.status !== 'pending');

  return (
    <div>
      {msg && <div className="hint" style={{ margin: '0 0 10px', fontWeight: 600 }}>{msg}</div>}

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Applications {pending.length ? `(${pending.length})` : ''}</h2>
        {!pending.length && <p className="hint">Nobody is waiting.</p>}
        {pending.map((a) => (
          <div key={a.id} style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 0' }}>
            <b>{a.name}</b> · {a.email}{a.phone ? ` · ${a.phone}` : ''}
            <div className="hint">Pays to {a.payoutEmail || '—'}</div>
            <div style={{ fontSize: 14, margin: '4px 0' }}>{a.audience}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="hint">Code (blank = from their name)<br />
                <input value={f(a.id, 'code')} onChange={(e) => setF(a.id, 'code', e.target.value)} placeholder="e.g. DAVE" style={{ width: 150 }} /></label>
              <label className="hint">Their commission %<br />
                <input value={f(a.id, 'pct')} onChange={(e) => setF(a.id, 'pct', e.target.value)} placeholder="5" style={{ width: 70 }} inputMode="decimal" /></label>
              <label className="hint">Customer gets % off<br />
                <input value={f(a.id, 'customerPct')} onChange={(e) => setF(a.id, 'customerPct', e.target.value)} placeholder="3" style={{ width: 70 }} inputMode="decimal" /></label>
              <button className="btn btn-primary" disabled={busy === a.id}
                onClick={() => act(a.id, { action: 'approve', code: f(a.id, 'code'), pct: f(a.id, 'pct'), customerPct: f(a.id, 'customerPct') }, `${a.name} approved.`)}>Approve</button>
              <button className="btn" disabled={busy === a.id} onClick={() => act(a.id, { action: 'reject' }, `${a.name} declined.`)}>Decline</button>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Affiliates</h2>
        {!rest.length && <p className="hint">No affiliates yet. Send people to <b>/affiliate</b> to apply.</p>}
        {rest.length > 0 && (
          <div className="table-wrap">
            <table className="admin">
              <thead><tr><th>Name</th><th>Code</th><th>Status</th><th style={{ textAlign: 'right' }}>Sales</th><th style={{ textAlign: 'right' }}>Pending</th>
                <th style={{ textAlign: 'right' }}>Payable</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Owed now</th><th /></tr></thead>
              <tbody>
                {rest.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}<div className="hint" style={{ margin: 0 }}>{a.email}</div></td>
                    <td><code>{a.code || '—'}</code> · {a.commissionPct}%</td>
                    <td><span className={'pill ' + (a.status === 'approved' ? 'ok' : 'sold')}>{a.status}</span></td>
                    <td style={{ textAlign: 'right' }}>{a.summary?.sales ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{a.summary ? $(a.summary.waiting + a.summary.hold) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{a.summary ? $(a.summary.payable) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{a.summary ? $(a.summary.paid) : '—'}</td>
                    <td style={{ textAlign: 'right' }}><b>{a.summary ? $(a.summary.balance) : '—'}</b></td>
                    <td><button className="btn" onClick={() => toggle(a.id)}>{open === a.id ? 'Close' : 'Open'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {open > 0 && detail?.affiliate && (
          <div style={{ borderTop: '2px solid var(--line-soft)', marginTop: 14, paddingTop: 12 }}>
            <h3 style={{ margin: 0, color: 'var(--charcoal)' }}>{detail.affiliate.name}</h3>
            <div className="hint">E-transfer to <b>{detail.affiliate.payoutEmail}</b>. Commission is payable once an order is delivered and its {detail.summary.holdDays}-day return window has closed.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', margin: '10px 0' }}>
              <label className="hint">Amount sent<br />
                <input value={f(open, 'amount')} onChange={(e) => setF(open, 'amount', e.target.value)} placeholder={String(Math.max(0, detail.summary.balance).toFixed(2))} style={{ width: 110 }} inputMode="decimal" /></label>
              <label className="hint">E-transfer reference<br />
                <input value={f(open, 'ref')} onChange={(e) => setF(open, 'ref', e.target.value)} style={{ width: 160 }} /></label>
              <button className="btn btn-primary" disabled={busy === open || !(Number(f(open, 'amount')) > 0)}
                onClick={() => act(open, { action: 'payout', amount: f(open, 'amount'), ref: f(open, 'ref') }, 'Payout recorded.')}>I sent it — record</button>
              {detail.affiliate.status === 'approved'
                ? <button className="btn" disabled={busy === open} onClick={() => act(open, { action: 'suspend' }, 'Suspended — the code stops working.')}>Suspend</button>
                : <button className="btn" disabled={busy === open} onClick={() => act(open, { action: 'reinstate' }, 'Reinstated.')}>Reinstate</button>}
            </div>
            <p className="hint">Recording does not send money — send the e-transfer from the bank first, then record it here so the balance drops. Owed now: <b>{$(detail.summary.balance)}</b>{detail.summary.balance > 0 && detail.summary.balance < detail.summary.minPayout ? ` (under the ${$(detail.summary.minPayout)} minimum — let it build)` : ''}.</p>
            <div className="table-wrap">
              <table className="admin">
                <thead><tr><th>Order</th><th>Sold</th><th>Delivered</th><th>What</th><th style={{ textAlign: 'right' }}>Goods</th><th style={{ textAlign: 'right' }}>Commission</th><th>Status</th></tr></thead>
                <tbody>
                  {detail.sales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.orderNumber}</td><td>{s.soldOn}</td><td>{s.deliveredOn || '—'}</td>
                      <td style={{ maxWidth: 260 }}>{s.what}</td>
                      <td style={{ textAlign: 'right' }}>{$(s.base)}</td><td style={{ textAlign: 'right' }}>{$(s.commission)}</td>
                      <td>{s.own ? 'void — their own order' : STATE[s.state]}{s.payableOn && s.state === 'hold' ? ` · payable ${s.payableOn}` : ''}</td>
                    </tr>
                  ))}
                  {!detail.sales.length && <tr><td colSpan={7} className="hint">No sales through this code yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {detail.payouts.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Paid out</h4>
                {detail.payouts.map((p) => <div key={p.id} className="hint" style={{ margin: 0 }}>{p.paidOn} · {$(p.amount)} · {p.method}{p.ref ? ` · ${p.ref}` : ''}{p.paidBy ? ` · by ${p.paidBy}` : ''}</div>)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

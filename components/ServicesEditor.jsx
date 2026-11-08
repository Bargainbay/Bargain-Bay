'use client';
import { useEffect, useState } from 'react';

// The service catalog: what a rep may quote (price) and what each one costs us
// (internal cost, shown only to the owner and the business-development rep).
// A blank cost means "nobody has entered it" — the quote's profit panel says so.
const BASES = [['order', 'per order'], ['unit', 'per unit'], ['hour', 'per hour'], ['appliance', 'per appliance']];
const TYPES = [['fixed', 'Fixed'], ['from', 'Starting from'], ['hourly', 'Hourly'], ['custom', 'Custom quote']];
const SIDES = [['rs', 'RS Solutions'], ['bb', 'Bargain Bay'], ['both', 'Both']];
const blank = { name: '', side: 'rs', pricingType: 'fixed', defaultPrice: '', internalCost: '', costBasis: 'order', bookable: false, active: true, description: '' };

const post = (body) => fetch('/api/admin/sales-services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

function Row({ s, onSaved }) {
  const [f, setF] = useState({ ...s, defaultPrice: s.defaultPrice ?? '', internalCost: s.internalCost ?? '' });
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save() {
    setMsg('');
    const r = await post({ service: f });
    if (!r.ok) { setMsg(r.error || 'Could not save.'); return; }
    setMsg('Saved'); onSaved();
  }
  return (
    <tr style={{ opacity: f.active ? 1 : 0.5 }}>
      <td><input value={f.name} onChange={set('name')} aria-label="Name" style={{ minWidth: 190 }} /></td>
      <td><select value={f.side} onChange={set('side')} aria-label="Side">{SIDES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td><select value={f.pricingType} onChange={set('pricingType')} aria-label="Pricing">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td><input value={f.defaultPrice} onChange={set('defaultPrice')} inputMode="decimal" aria-label="Price" style={{ width: 80 }} /></td>
      <td><input value={f.internalCost} onChange={set('internalCost')} inputMode="decimal" aria-label="Internal cost" placeholder="not set" style={{ width: 80 }} /></td>
      <td><select value={f.costBasis} onChange={set('costBasis')} aria-label="Cost basis">{BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td><label><input type="checkbox" style={{ width: 'auto' }} checked={f.bookable} onChange={set('bookable')} /> bookable</label></td>
      <td><label><input type="checkbox" style={{ width: 'auto' }} checked={f.active} onChange={set('active')} /> on</label></td>
      <td><button className="btn" onClick={save}>Save</button>{msg && <div className="hint" role="status">{msg}</div>}</td>
    </tr>
  );
}

export default function ServicesEditor() {
  const [data, setData] = useState(null);
  const [nf, setNf] = useState(blank);
  const [err, setErr] = useState('');
  const [threshold, setThreshold] = useState('');
  const load = () => fetch('/api/admin/sales-services').then((r) => r.json()).then((d) => { setData(d); setThreshold(String(d.threshold ?? 100)); });
  useEffect(() => { load(); }, []);
  if (!data) return <div className="panel">Loading…</div>;
  const rows = data.services || [];

  async function add() {
    setErr('');
    const r = await post({ service: nf });
    if (!r.ok) { setErr(r.error || 'Could not add.'); return; }
    setNf(blank); load();
  }
  return (
    <div>
      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>
          The <b>price</b> is what a customer sees; the <b>internal cost</b> is what it costs us and is shown only to you and the
          business-development rep. Every quote shows live profit: a service added <b>Charged</b> adds its price and takes off its cost,
          one added <b>Included</b> only takes off its cost.
        </p>
        {rows.length === 0 && <button className="btn accent" onClick={async () => { await post({ action: 'starter' }); load(); }}>Add the starting list</button>}
        {rows.length > 0 && <button className="btn" onClick={async () => { const r = await post({ action: 'starter' }); setErr(r.added ? '' : 'Every starting service is already here.'); load(); }}>Add any missing starting services</button>}
        {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
      </div>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="admin" style={{ minWidth: 980 }}>
          <thead><tr><th>Service</th><th>Side</th><th>Pricing</th><th>Price $</th><th>Our cost $</th><th>Cost applies</th><th></th><th></th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => <Row key={`${s.id}-${s.name}-${s.defaultPrice}-${s.internalCost}-${s.active}`} s={s} onSaved={load} />)}
            <tr>
              <td><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="New service" aria-label="New service name" /></td>
              <td><select value={nf.side} onChange={(e) => setNf({ ...nf, side: e.target.value })} aria-label="New side">{SIDES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><select value={nf.pricingType} onChange={(e) => setNf({ ...nf, pricingType: e.target.value })} aria-label="New pricing">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><input value={nf.defaultPrice} onChange={(e) => setNf({ ...nf, defaultPrice: e.target.value })} inputMode="decimal" style={{ width: 80 }} aria-label="New price" /></td>
              <td><input value={nf.internalCost} onChange={(e) => setNf({ ...nf, internalCost: e.target.value })} inputMode="decimal" style={{ width: 80 }} aria-label="New cost" /></td>
              <td><select value={nf.costBasis} onChange={(e) => setNf({ ...nf, costBasis: e.target.value })} aria-label="New basis">{BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td colSpan={2} /><td><button className="btn accent" onClick={add}>Add</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <label htmlFor="lp-th" style={{ fontWeight: 700 }}>Low-profit warning under ($)</label>{' '}
        <input id="lp-th" value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" style={{ width: 90 }} />{' '}
        <button className="btn" onClick={async () => { const r = await post({ action: 'threshold', value: threshold }); setErr(r.ok ? '' : r.error); }}>Save</button>
        <span className="hint"> Yellow, never blocks. Red under $0.</span>
      </div>
    </div>
  );
}

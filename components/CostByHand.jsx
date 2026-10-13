'use client';
import { useEffect, useState } from 'react';

const money = (v) => `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Sold units that nobody has a cost for -- not the invoice, not the site, not the
// tracker. A person types what it cost; it goes onto the invoice line and its order.
export default function CostByHand() {
  const [lines, setLines] = useState(null);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => fetch('/api/admin/cost-audit?kind=person', { cache: 'no-store' }).then((r) => r.json())
    .then((d) => (d.error ? setErr(d.error) : setLines(d.lines))).catch(() => setErr('Could not load the list.'));
  useEffect(() => { load(); }, []);

  async function save(l) {
    setBusy(l.id); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/admin/cost-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, kind: 'hand', lineId: l.id, cost: vals[l.id] }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setMsg(`${l.sku} on ${l.invoice} saved at ${money(d.cost)}.`);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Type in a missing cost</h2>
      <p className="hint">
        Sold units with no cost anywhere: not on the invoice, the site or the tracker. Type what it cost <b>before HST</b>
        (a drop-off from Abi is the one exception: his cost already includes tax, so type the full figure). Use 0 only if it
        really cost nothing. This fills a blank only; it never overwrites a cost that is already there.
      </p>
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {msg && <p style={{ color: 'var(--ok)' }}><b>{msg}</b></p>}
      {lines == null ? <p className="hint">Loading…</p> : lines.length === 0 ? <p>Nothing is waiting for a typed cost.</p> : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Day</th><th>Invoice</th><th>Customer</th><th>Unit</th><th style={{ textAlign: 'right' }}>Sold (before HST)</th><th>Cost</th><th></th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{l.day}</td><td>{l.invoice}</td><td>{l.customer}</td>
              <td>{l.sku}<div className="hint">{String(l.description || '').slice(0, 50)}</div></td>
              <td style={{ textAlign: 'right' }}>{money(l.sold)}</td>
              <td><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="cost" style={{ width: 100 }}
                value={vals[l.id] ?? ''} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} /></td>
              <td><button type="button" className="dash-filter active" disabled={busy === l.id || (vals[l.id] ?? '') === ''} onClick={() => save(l)}>
                {busy === l.id ? 'Saving…' : 'Save'}</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

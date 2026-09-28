'use client';
import { useEffect, useState } from 'react';

// Raising a purchase order.
//
// This did not exist. `createPurchaseOrder` and the API route that calls it
// have been here since the ordering feature shipped and nothing on any screen
// ever reached them — so "On order" rendered empty on the live site, receiving
// had nothing to receive against, and three-way matching had no orders to
// match. The whole feature was reachable only by posting JSON by hand.
const blankLine = () => ({ key: Math.random().toString(36).slice(2), description: '', make: '', model: '', category: '', qty: '1', unitCost: '', partId: '' });
const money = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function post(body) {
  const res = await fetch('/api/admin/purchase-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'That did not work.');
  return d;
}
const inp = { padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13.5 };

export default function PurchaseOrderForm({ onCreated, prefill = null, onCancel }) {
  const [suppliers, setSuppliers] = useState([]);
  const [parts, setParts] = useState([]);
  const [f, setF] = useState(() => ({
    vendor: prefill?.vendor || '', orderNumber: '', expectedOn: '', note: prefill?.note || ''
  }));
  const [lines, setLines] = useState(() => (prefill?.lines?.length
    ? prefill.lines.map((l) => ({ ...blankLine(), ...l, qty: String(l.qty ?? 1) }))
    : [blankLine()]));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/admin/purchase-orders?view=setup', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setSuppliers(d.suppliers || []); setParts(d.parts || []); })
      .catch(() => {});
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  async function submit() {
    setBusy(true); setErr('');
    try {
      const d = await post({
        action: 'create', vendor: f.vendor, orderNumber: f.orderNumber,
        expectedOn: f.expectedOn || null, note: f.note,
        lines: lines.map((l) => ({
          description: l.description, make: l.make, model: l.model, category: l.category,
          qty: Number(l.qty) || 1, unitCost: l.unitCost === '' ? null : Number(l.unitCost),
          partId: l.partId ? Number(l.partId) : null
        }))
      });
      onCreated?.(d);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Raise a purchase order</h3>
      {err && <div className="error-box">{err}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {/* A known supplier is PICKED, so the order attaches itself to the
            supplier master and gets their terms and their on-time record. A name
            that is not on file is still allowed — an order must never be blocked
            because somebody new has not been added yet — and it turns up on the
            unknown-names list to be answered once. */}
        <input list="po-suppliers" placeholder="Supplier" value={f.vendor} onChange={set('vendor')}
               style={{ ...inp, width: 200 }} />
        <datalist id="po-suppliers">
          {suppliers.map((s) => <option key={s.id} value={s.name} />)}
        </datalist>
        <input placeholder="Their order number" value={f.orderNumber} onChange={set('orderNumber')}
               style={{ ...inp, width: 170 }}
               title="The supplier's own number. It names the tracker lot when this is received, so their invoice lands on the lot that is already there." />
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          Due{' '}
          <input type="date" value={f.expectedOn} onChange={set('expectedOn')} style={inp} />
        </label>
      </div>
      <p className="hint" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
        A supplier we already know gets their terms and their on-time record. A new name is fine —
        the order is raised either way and the name turns up under &ldquo;names nobody has
        identified&rdquo; to answer once.
      </p>

      <div className="table-wrap" style={{ marginTop: 10 }}><table className="admin">
        <thead><tr>
          <th>What</th><th>Make</th><th>Model</th>
          <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit cost</th><th />
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td>
                {l.partId ? (
                  <span><b>{parts.find((p) => String(p.id) === String(l.partId))?.name || l.description}</b>
                    <div className="hint" style={{ fontSize: 12 }}>a part off the shelf</div></span>
                ) : (
                  <input placeholder="Description" value={l.description}
                         onChange={(e) => setLine(i, 'description', e.target.value)} style={{ ...inp, width: 200 }} />
                )}
              </td>
              <td>{!l.partId && <input placeholder="Make" value={l.make}
                     onChange={(e) => setLine(i, 'make', e.target.value)} style={{ ...inp, width: 110 }} />}</td>
              <td>{!l.partId && <input placeholder="Model" value={l.model}
                     onChange={(e) => setLine(i, 'model', e.target.value)} style={{ ...inp, width: 130 }} />}</td>
              <td style={{ textAlign: 'right' }}>
                <input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)}
                       style={{ ...inp, width: 64, textAlign: 'right' }} />
              </td>
              <td style={{ textAlign: 'right' }}>
                <input type="number" min={0} step="0.01" placeholder="—" value={l.unitCost}
                       onChange={(e) => setLine(i, 'unitCost', e.target.value)}
                       style={{ ...inp, width: 90, textAlign: 'right' }}
                       title="What we agreed to pay. A unit received against this order arrives PRICED — that is the whole gain over waiting for the invoice." />
              </td>
              <td style={{ textAlign: 'right' }}>
                {lines.length > 1 && (
                  <button className="btn" style={{ fontSize: 11 }}
                          onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn" onClick={() => setLines([...lines, blankLine()])}>+ Another line</button>
        {parts.length > 0 && (
          <select value="" style={{ ...inp, maxWidth: 220 }} onChange={(e) => {
            if (!e.target.value) return;
            const p = parts.find((x) => String(x.id) === e.target.value);
            setLines([...lines.filter((l) => l.description || l.make || l.model || l.partId),
                      { ...blankLine(), partId: p.id, description: p.name, qty: String(p.suggestQty || 1) }]);
          }}>
            <option value="">+ A part off the shelf…</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.partNumber ? ` (${p.partNumber})` : ''}</option>)}
          </select>
        )}
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {total > 0 ? <>Order value <b>{money(total)}</b></> : 'No costs entered'}
        </span>
      </div>

      <input placeholder="Note (optional)" value={f.note} onChange={set('note')}
             style={{ ...inp, width: '100%', marginTop: 8 }} />

      <div style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={busy || !f.vendor.trim()} onClick={submit}>
          {busy ? 'Raising…' : 'Raise the order'}
        </button>
        <button className="btn" style={{ marginLeft: 6 }} onClick={onCancel}>Cancel</button>
      </div>
      <p className="hint" style={{ fontSize: 12.5, marginBottom: 0 }}>
        Raising an order does not touch stock. The appliances reach the tracker — priced from this
        order — when you <b>receive</b> them.
      </p>
    </div>
  );
}

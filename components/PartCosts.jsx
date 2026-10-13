'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const money = (v) => (v == null ? '—' : `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const field = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', font: 'inherit' };
const blank = () => ({ partName: '', partNumber: '', supplier: '', amount: '', orderedOn: today(), note: '' });

// Record money spent on a part for ONE unit. The unit's parts are summed into the
// tracker's Parts Cost cell, so Total Cost, the site cost and the profit reports follow.
export default function PartCosts({ recent }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [unit, setUnit] = useState(null);
  const [lines, setLines] = useState([]);
  const [form, setForm] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return undefined; }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch('/api/admin/part-costs?q=' + encodeURIComponent(q.trim()));
        const d = await r.json();
        setResults(r.ok ? d.units : []);
      } catch { setResults([]); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  async function pick(u) {
    setUnit(u); setResults(null); setQ(''); setErr(''); setOk(''); setForm(blank());
    const r = await fetch('/api/admin/part-costs?sku=' + encodeURIComponent(u.sku));
    const d = await r.json();
    setLines(r.ok ? d.lines : []);
  }

  async function refresh(sku) {
    const [a, b] = await Promise.all([
      fetch('/api/admin/part-costs?sku=' + encodeURIComponent(sku)).then((r) => r.json()),
      fetch('/api/admin/part-costs?q=' + encodeURIComponent(sku)).then((r) => r.json())
    ]);
    setLines(a.lines || []);
    const fresh = (b.units || []).find((x) => x.sku === sku);
    if (fresh) setUnit(fresh);
    router.refresh();
  }

  async function send(body, success) {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await fetch('/api/admin/part-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) {
        if (d.needsAdopt && confirm(d.error)) return send({ ...body, adoptExisting: true }, success);
        throw new Error(d.error || 'Failed');
      }
      setOk(success(d)); setForm(blank());
      await refresh(unit.sku);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const add = () => send({ action: 'add', sku: unit.sku, ...form },
    (d) => `Saved. Parts on ${unit.sku} now total ${money(d.partsTotal)}; the tracker's Total Cost is ${money(d.totalCost)}.`);
  const voidLine = (l) => { if (confirm(`Void "${l.partName}" (${money(l.amount)})? The unit's parts cost goes down by that amount.`)) send({ action: 'void', id: l.id }, (d) => `Voided. Parts on ${unit.sku} now total ${money(d.partsTotal)}.`); };

  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Parts costs</h1>
      <p className="hint">
        Record money spent on a part that was <b>actually bought</b> for a unit. Parts are added up and written to the tracker&apos;s
        <b> Parts Cost</b> cell, so the unit&apos;s Total Cost, the site&apos;s cost and the profit reports follow. Amounts before tax.
        Parts you take off the shelf are costed on the <a href="/admin/parts">Parts</a> tab.
      </p>

      <label style={{ display: 'block', maxWidth: 520 }}>Find the unit
        <input style={{ ...field, width: '100%', display: 'block', marginTop: 4 }} placeholder="SKU, model, make or serial" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {results && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, maxWidth: 520, marginTop: 6 }}>
          {results.length === 0 && <div className="hint" style={{ padding: 10 }}>No unit matches that.</div>}
          {results.map((u) => (
            <button type="button" key={u.sku} onClick={() => pick(u)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 0, borderBottom: '1px solid var(--line)', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
              <b>{u.sku}</b> · {[u.make, u.model].filter(Boolean).join(' ') || u.description} <span className="hint">· {u.status || 'no status'} · cost {money(u.totalCost)}</span>
            </button>
          ))}
        </div>
      )}

      {unit && (
        <div style={{ marginTop: 18, padding: 16, border: '2px solid var(--charcoal)', borderRadius: 12, maxWidth: 680 }}>
          <b style={{ fontSize: 16 }}>{unit.sku}</b> · {[unit.make, unit.model].filter(Boolean).join(' ') || unit.description}
          <div className="hint" style={{ margin: '2px 0 10px' }}>{unit.status} · {unit.vendor || 'no vendor'}</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <span>Cost of product <b>{money(unit.productCost)}</b></span>
            <span>Parts <b>{money(unit.partsCost)}</b></span>
            <span>Total cost <b>{money(unit.totalCost)}</b></span>
          </div>

          {lines.length > 0 && (
            <div className="table-wrap"><table className="admin" style={{ marginBottom: 12 }}>
              <thead><tr><th>Part</th><th>Supplier</th><th>Ordered</th><th style={{ textAlign: 'right' }}>Cost</th><th></th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id} style={l.voided ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
                  <td>{l.partName}{l.partNumber ? <span className="hint"> · {l.partNumber}</span> : null}</td>
                  <td>{l.supplier || '—'}</td><td>{l.orderedOn}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                  <td>{!l.voided && <button type="button" className="dash-filter" disabled={busy} onClick={() => voidLine(l)}>Void</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            <b>Add a part that was bought</b>
            <label>Part<input style={{ ...field, width: '100%', display: 'block' }} placeholder="Ice maker, control board…" value={form.partName} onChange={(e) => setForm({ ...form, partName: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 160px' }}>Part number (if known)<input style={{ ...field, width: '100%', display: 'block' }} value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} /></label>
              <label style={{ flex: '1 1 160px' }}>Supplier<input style={{ ...field, width: '100%', display: 'block' }} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 160px' }}>Cost before tax ($)<input style={{ ...field, width: '100%', display: 'block' }} type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              <label style={{ flex: '1 1 160px' }}>Ordered on<input style={{ ...field, width: '100%', display: 'block' }} type="date" value={form.orderedOn} onChange={(e) => setForm({ ...form, orderedOn: e.target.value })} /></label>
            </div>
            <label>Note (optional)<input style={{ ...field, width: '100%', display: 'block' }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="dash-filter active" disabled={busy} onClick={add}>{busy ? 'Saving…' : 'Add to this unit'}</button>
              <button type="button" className="dash-filter" disabled={busy} onClick={() => { setUnit(null); setLines([]); }}>Close</button>
              {ok && <span style={{ color: 'var(--ok)', fontSize: 13 }}>{ok}</span>}
              {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
            </div>
          </div>
        </div>
      )}

      <h2 style={{ color: 'var(--charcoal)', marginTop: 24 }}>Recent</h2>
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Unit</th><th>Part</th><th>Supplier</th><th>Ordered</th><th style={{ textAlign: 'right' }}>Cost</th><th>By</th></tr></thead>
        <tbody>
          {recent.length === 0 && <tr><td colSpan={6} className="hint">Nothing recorded yet.</td></tr>}
          {recent.map((l) => (
            <tr key={l.id} style={l.voided ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
              <td>{l.sku}</td><td>{l.partName}</td><td>{l.supplier || '—'}</td><td>{l.orderedOn}</td>
              <td style={{ textAlign: 'right' }}>{money(l.amount)}</td><td>{l.createdBy || l.source}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

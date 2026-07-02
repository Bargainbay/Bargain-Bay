'use client';
import { useState } from 'react';

// Upload a supplier purchase invoice (PDF/image) → AI extracts the units + costs →
// review/edit → write them into the master tracker as "Untested".
const CATEGORIES = ['Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Laundry Center', 'Dishwasher', 'Range', 'Wall Oven', 'Microwave', 'Range Hood', 'Cooktop', 'TV', 'Vacuum', 'Small Appliance', 'Other'];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function PurchaseIntake() {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  const [head, setHead] = useState({ vendor: '', invoice: '', date: '' });
  const [items, setItems] = useState(null);
  const [done, setDone] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('reading'); setErr(''); setWarn(''); setDone(null); setItems(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch('/api/admin/purchase-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract', fileBase64, mediaType: file.type || 'application/pdf' })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not read that file.'); return; }
      setHead({ vendor: d.vendor || '', invoice: d.invoiceNumber || '', date: d.date || '' });
      setItems((d.items || []).map((it) => ({ ...it, retail: it.retail ?? '', cost: it.cost ?? '' })));
      if (d.truncated) setWarn(`That invoice was too long to read in one pass — only the first ${d.items?.length || 0} items were read. Check the list against the invoice and upload the remaining pages separately.`);
      if (!d.items?.length) setErr('No product line items found — try a clearer scan.');
    } catch {
      setErr('Upload failed — try again.');
    } finally {
      setBusy(''); e.target.value = '';
    }
  }

  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const removeItem = (i) => setItems((xs) => xs.filter((_, j) => j !== i));

  async function commit() {
    setBusy('commit'); setErr('');
    try {
      const res = await fetch('/api/admin/purchase-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', vendor: head.vendor, invoice: head.invoice, items })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add to tracker.'); return; }
      setDone(d); setItems(null);
    } catch {
      setErr('Network error.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Upload a supplier purchase invoice (PDF or photo). I&apos;ll read the units and costs, you review them, then I add
        them to the master tracker as <b>Untested</b> — no spreadsheet typing.
      </p>

      <label className="btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
        {busy === 'reading' ? 'Reading…' : '📄 Upload purchase invoice'}
        <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={onFile} disabled={!!busy} />
      </label>

      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {warn && <div className="notice-box" style={{ marginTop: 10 }}>⚠ {warn}</div>}
      {done && (
        <div className="notice-box" style={{ marginTop: 10 }}>
          ✓ Added <b>{done.count}</b> unit{done.count === 1 ? '' : 's'} to the tracker{done.addedSkus?.length ? ` (${done.addedSkus.join(', ')})` : ''}.
          They&apos;re held off the storefront until confirmed tested-working.
          {done.failed?.length ? <div style={{ color: 'var(--danger)', marginTop: 6 }}>{done.failed.length} couldn&apos;t be added.</div> : null}
        </div>
      )}

      {items && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>Vendor <input value={head.vendor} onChange={(e) => setHead({ ...head, vendor: e.target.value })} placeholder="e.g. SecondShop" /></label>
            <label style={{ fontSize: 13 }}>Invoice # <input value={head.invoice} onChange={(e) => setHead({ ...head, invoice: e.target.value })} /></label>
          </div>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Description</th><th>Make</th><th>Model</th><th>Serial</th><th>Category</th><th style={{ textAlign: 'right' }}>Retail</th><th style={{ textAlign: 'right' }}>Cost</th><th>Qty</th><th></th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td><input style={{ width: 240 }} value={it.description || ''} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. Blomberg 24in Washer/Dryer Combo, White" title="Searchable product title — include the appliance type" /></td>
                  <td><input style={{ width: 90 }} value={it.make} onChange={(e) => setItem(i, 'make', e.target.value)} /></td>
                  <td><input style={{ width: 130 }} value={it.model} onChange={(e) => setItem(i, 'model', e.target.value)} /></td>
                  <td><input style={{ width: 100 }} value={it.serial || ''} onChange={(e) => setItem(i, 'serial', e.target.value)} /></td>
                  <td>
                    <select value={it.category} onChange={(e) => setItem(i, 'category', e.target.value)} style={{ fontSize: 12.5 }}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td><input style={{ width: 80, textAlign: 'right' }} type="number" step="0.01" value={it.retail} onChange={(e) => setItem(i, 'retail', e.target.value)} /></td>
                  <td><input style={{ width: 80, textAlign: 'right' }} type="number" step="0.01" value={it.cost} onChange={(e) => setItem(i, 'cost', e.target.value)} placeholder="cost" /></td>
                  <td><input style={{ width: 48 }} type="number" min="1" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} /></td>
                  <td><button type="button" className="btn" style={{ padding: '0 10px' }} onClick={() => removeItem(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn accent" disabled={busy === 'commit' || !items.length} onClick={commit}>
              {busy === 'commit' ? 'Adding…' : `Add ${items.length} unit${items.length === 1 ? '' : 's'} to tracker`}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => { setItems(null); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useState } from 'react';

// Review queue for AI-extracted purchase invoices (from the email watcher). The
// owner edits if needed, then approves → units are written to the master tracker.
const CATEGORIES = ['Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Laundry Center', 'Dishwasher', 'Range', 'Wall Oven', 'Microwave', 'Range Hood', 'Cooktop', 'Other'];

export default function IntakeQueue({ initialPending = [] }) {
  const [pending, setPending] = useState(initialPending);
  const [edits, setEdits] = useState({}); // id -> {vendor, invoice, items}
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const draft = (q) => edits[q.id] || { vendor: q.vendor || '', invoice: q.invoice || '', items: q.items || [] };
  const setDraft = (id, d) => setEdits((e) => ({ ...e, [id]: d }));
  const setItem = (q, i, k, v) => {
    const d = draft(q);
    setDraft(q.id, { ...d, items: d.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) });
  };
  const removeItem = (q, i) => { const d = draft(q); setDraft(q.id, { ...d, items: d.items.filter((_, j) => j !== i) }); };

  async function send(action, q, extra) {
    setBusy(`${action}:${q ? q.id : 'all'}`); setMsg('');
    try {
      const res = await fetch('/api/admin/intake-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: q?.id, ...extra })
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || 'Failed'); return; }
      if (Array.isArray(d.pending)) setPending(d.pending);
      if (action === 'commit') setMsg(`✓ Added ${d.count} unit(s) to the tracker${d.addedSkus?.length ? ` (${d.addedSkus.join(', ')})` : ''}.`);
      if (action === 'refresh') setMsg(d.queued ? `Found ${d.queued} new invoice(s).` : 'No new invoices in the inbox.');
    } catch { setMsg('Network error'); } finally { setBusy(''); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p className="hint" style={{ margin: 0 }}>
          Purchase invoices the watcher read from <b>accounting@</b>, waiting for your OK before they hit the tracker.
        </p>
        <button className="btn" disabled={!!busy} onClick={() => send('refresh', null)}>
          {busy.startsWith('refresh') ? 'Checking…' : 'Check inbox now'}
        </button>
      </div>
      {msg && <div className="notice-box" style={{ marginTop: 8 }}>{msg}</div>}
      {pending.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 14 }}>Nothing waiting — purchase invoices emailed to accounting@ will show up here.</p>}

      {pending.map((q) => {
        const d = draft(q);
        return (
          <div key={q.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginTop: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              From <b>{q.sender || '—'}</b>{q.subject ? ` · ${q.subject}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 13 }}>Vendor <input value={d.vendor} onChange={(e) => setDraft(q.id, { ...d, vendor: e.target.value })} placeholder="e.g. SecondShop" /></label>
              <label style={{ fontSize: 13 }}>Invoice # <input value={d.invoice} onChange={(e) => setDraft(q.id, { ...d, invoice: e.target.value })} /></label>
            </div>
            <div className="table-wrap"><table className="admin">
              <thead><tr><th>Description</th><th>Make</th><th>Model</th><th>Category</th><th style={{ textAlign: 'right' }}>Retail</th><th style={{ textAlign: 'right' }}>Cost</th><th>Qty</th><th></th></tr></thead>
              <tbody>
                {d.items.map((it, i) => (
                  <tr key={i}>
                    <td><input style={{ width: 230 }} value={it.description || ''} onChange={(e) => setItem(q, i, 'description', e.target.value)} placeholder="Searchable title (include appliance type)" /></td>
                    <td><input style={{ width: 85 }} value={it.make || ''} onChange={(e) => setItem(q, i, 'make', e.target.value)} /></td>
                    <td><input style={{ width: 125 }} value={it.model || ''} onChange={(e) => setItem(q, i, 'model', e.target.value)} /></td>
                    <td><select value={it.category || 'Other'} onChange={(e) => setItem(q, i, 'category', e.target.value)} style={{ fontSize: 12.5 }}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><input style={{ width: 75, textAlign: 'right' }} type="number" step="0.01" value={it.retail ?? ''} onChange={(e) => setItem(q, i, 'retail', e.target.value)} /></td>
                    <td><input style={{ width: 75, textAlign: 'right' }} type="number" step="0.01" value={it.cost ?? ''} onChange={(e) => setItem(q, i, 'cost', e.target.value)} /></td>
                    <td><input style={{ width: 44 }} type="number" min="1" value={it.qty ?? 1} onChange={(e) => setItem(q, i, 'qty', e.target.value)} /></td>
                    <td><button type="button" className="btn" style={{ padding: '0 9px' }} onClick={() => removeItem(q, i)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="btn accent" disabled={!!busy || !d.items.length} onClick={() => send('commit', q, { vendor: d.vendor, invoice: d.invoice, items: d.items })}>
                {busy === `commit:${q.id}` ? 'Adding…' : `Add ${d.items.length} to tracker`}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => send('reject', q)}>Dismiss</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';
import { useState } from 'react';

const blankItem = () => ({ description: '', amount: '' });

export default function InvoiceForm({ inventory = [], customers = [] }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [q, setQ] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const [addHst, setAddHst] = useState(true);
  const [daysUntilDue, setDaysUntilDue] = useState(14);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addRow = () => setItems((xs) => [...xs, blankItem()]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));

  const matches = q.trim().length >= 2
    ? inventory.filter((u) => u.search.includes(q.trim().toLowerCase())).slice(0, 8)
    : [];

  const custQuery = (email || name).trim().toLowerCase();
  const custMatches = custOpen && custQuery.length >= 2
    ? customers.filter((c) => c.search.includes(custQuery) && c.email.toLowerCase() !== email.trim().toLowerCase()).slice(0, 6)
    : [];
  function pickCustomer(c) {
    setName(c.name || '');
    setEmail(c.email || '');
    setCustOpen(false);
  }
  function pickInventory(u) {
    const filled = { description: u.description, amount: String(u.price) };
    setItems((xs) => {
      const empty = xs.findIndex((it) => !it.description && !it.amount);
      return empty >= 0 ? xs.map((it, j) => (j === empty ? filled : it)) : [...xs, filled];
    });
    setQ('');
  }

  const subtotal = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const hst = addHst ? subtotal * 0.13 : 0;
  const total = subtotal + hst;
  const fmt = (n) => '$' + n.toFixed(2);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setDone(null);
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, items, addHst, daysUntilDue, memo })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not create the invoice.'); return; }
      setDone(d.invoice);
      setName(''); setEmail(''); setItems([blankItem()]); setMemo('');
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        ✓ Invoice <b>{done.number}</b> for <b>{fmt(done.total)}</b> created and emailed to <b>{done.email}</b>.
        {done.hostedUrl && <> <a href={done.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>View / pay link →</a></>}
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setDone(null)}>Create another</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-box">{err}</div>}
      <div className="form-2col">
        <div className="field">
          <label>Customer name</label>
          <input value={name} onChange={(e) => { setName(e.target.value); setCustOpen(true); }} placeholder="Jane Smith" />
        </div>
        <div className="field">
          <label>Customer email *</label>
          <input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setCustOpen(true); }} placeholder="jane@example.com" autoComplete="off" />
        </div>
      </div>
      {custMatches.length > 0 && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, margin: '-6px 0 12px', maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 11px', borderBottom: '1px solid var(--line-soft)' }}>Existing customers</div>
          {custMatches.map((c) => (
            <button type="button" key={c.email} onClick={() => pickCustomer(c)}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '8px 11px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
              <span>{c.name || '(no name)'}<span style={{ color: 'var(--muted)' }}> · {c.email}</span></span>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{c.phone || ''}</span>
            </button>
          ))}
        </div>
      )}

      {inventory.length > 0 && (
        <div className="field">
          <label>Add from inventory</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your stock by model, name, or SKU…" />
          {matches.length > 0 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, maxHeight: 230, overflowY: 'auto' }}>
              {matches.map((u) => (
                <button type="button" key={u.id} onClick={() => pickInventory(u)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '8px 11px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span>{u.description}</span>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontWeight: 600 }}>${u.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="hint">Picking a unit fills a line below with its name, SKU, and price — you can still edit the amount.</div>
        </div>
      )}

      <label style={{ fontSize: 13, fontWeight: 500, display: 'block', margin: '4px 0 6px' }}>Line items</label>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ flex: 1 }} value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. Whirlpool WRS321SDHZ refrigerator" />
          <input style={{ width: 120 }} type="number" min="0" step="0.01" value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} placeholder="0.00" />
          <button type="button" className="btn" style={{ padding: '0 12px' }} onClick={() => removeRow(i)} aria-label="Remove line">×</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={addRow} style={{ marginBottom: 12 }}>+ Add line</button>

      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={addHst} onChange={(e) => setAddHst(e.target.checked)} /> Add 13% HST
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          Due in
          <input style={{ width: 70 }} type="number" min="1" max="90" value={daysUntilDue} onChange={(e) => setDaysUntilDue(e.target.value)} /> days
        </label>
      </div>

      <div className="field">
        <label>Memo / notes (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Shown on the invoice" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>
          Subtotal {fmt(subtotal)}{addHst ? ` · HST ${fmt(hst)}` : ''} · <b style={{ color: 'var(--charcoal)' }}>Total {fmt(total)}</b>
        </div>
        <button className="btn accent" disabled={busy}>{busy ? 'Creating…' : 'Create & send invoice'}</button>
      </div>
    </form>
  );
}

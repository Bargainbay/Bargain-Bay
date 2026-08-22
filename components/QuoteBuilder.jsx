'use client';
import { useState } from 'react';

const blankItem = () => ({ description: '', retail: '', amount: '', sku: '' });
const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// editQuote = { quoteId, number, bundlePct, cashDeal, freeDelivery, addHst, daysValid, memo }
// switches the builder into edit-in-place mode: same Q- number, PATCH instead of create.
export default function QuoteBuilder({ inventory = [], customers = [], initial = null, editQuote = null }) {
  const [name, setName] = useState(initial?.name || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [items, setItems] = useState(
    initial?.items?.length
      ? initial.items.map((it) => ({ description: it.description || '', retail: it.retail || '', amount: it.amount || '', sku: it.sku || '' }))
      : [blankItem()]
  );
  const sourceQuoteId = editQuote ? null : (initial?.sourceQuoteId || null);
  const [q, setQ] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const [bundlePct, setBundlePct] = useState(editQuote?.bundlePct ?? 10);
  const [cashDeal, setCashDeal] = useState(editQuote?.cashDeal ?? '');
  const [freeDelivery, setFreeDelivery] = useState(!!editQuote?.freeDelivery);
  const [addHst, setAddHst] = useState(editQuote ? editQuote.addHst !== false : true);
  const [daysValid, setDaysValid] = useState(editQuote?.daysValid ?? 14);
  const [memo, setMemo] = useState(editQuote?.memo || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addRow = () => setItems((xs) => [...xs, blankItem()]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));

  // Tokenize: every word in the query must appear somewhere in the unit's
  // searchable text, so "kitchenaid dishwasher" matches even though brand and
  // type sit far apart in the string. (A plain substring match needs the whole
  // phrase contiguous and silently finds nothing.)
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = q.trim().length >= 2
    ? inventory.filter((u) => tokens.every((t) => u.search.includes(t))).slice(0, 8)
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
    const filled = { description: u.description, retail: u.retail ? String(u.retail) : '', amount: String(u.price), sku: u.id };
    setItems((xs) => {
      const empty = xs.findIndex((it) => !it.description && !it.amount);
      return empty >= 0 ? xs.map((it, j) => (j === empty ? filled : it)) : [...xs, filled];
    });
    setQ('');
  }

  // Live preview — mirrors the authoritative math on the server (lib/quotes).
  const retailSubtotal = items.reduce((a, it) => a + (Number(it.retail) || 0), 0);
  const subtotal = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const pct = Math.min(Math.max(Number(bundlePct) || 0, 0), 90);
  const bundlePrice = subtotal * (1 - pct / 100);
  const hst = addHst ? bundlePrice * 0.13 : 0;
  const bundleTotal = bundlePrice + hst;
  const cash = Number(cashDeal) > 0 ? Number(cashDeal) : null;
  const total = cash != null ? cash : bundleTotal;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setDone(null);
    try {
      const res = await fetch('/api/admin/quotes', {
        method: editQuote ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editQuote
          ? { action: 'update', quoteId: editQuote.quoteId, name, email, items, bundlePct: pct, cashDeal, freeDelivery, addHst, daysValid, memo }
          : { name, email, items, bundlePct: pct, cashDeal, freeDelivery, addHst, daysValid, memo, sourceQuoteId })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || (editQuote ? 'Could not update the quote.' : 'Could not create the quote.')); return; }
      setDone(d.quote);
      if (!editQuote) { setName(''); setEmail(''); setItems([blankItem()]); setMemo(''); setCashDeal(''); setFreeDelivery(false); }
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        ✓ Quote <b>{done.number}</b> for <b>{fmt(done.total)}</b> {editQuote ? 'updated and re-emailed to' : 'created and emailed to'} <b>{done.email}</b>.
        {done.hostedUrl && <> <a href={done.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Open quote / copy link →</a></>}
        <div className="hint" style={{ marginTop: 4 }}>Nothing is reserved — the units stay live until you convert this quote to an invoice.</div>
        <div style={{ marginTop: 10 }}>
          {editQuote
            ? <a className="btn" href="/admin/quotes">← Back to quotes</a>
            : <button className="btn" onClick={() => setDone(null)}>Build another</button>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-box">{err}</div>}
      {sourceQuoteId && (
        <div className="notice-box" style={{ marginBottom: 12 }}>
          Pricing a customer request — set your bundle discount and send. The original request is filed away once you send this quote.
        </div>
      )}
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
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontWeight: 600 }}>{fmt(u.price)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="hint">Adds a line with the unit&apos;s name, SKU, retail and our price. You can also type ad-hoc lines for items not yet in stock.</div>
        </div>
      )}

      <label style={{ fontSize: 13, fontWeight: 500, display: 'block', margin: '4px 0 6px' }}>Line items</label>
      <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--muted)', padding: '0 2px 4px' }}>
        <span style={{ flex: 1 }}>Item</span>
        <span style={{ width: 110 }}>Retail</span>
        <span style={{ width: 110 }}>Our price</span>
        <span style={{ width: 34 }} />
      </div>
      {items.map((it, i) => (
        <div key={i} className="inv-line">
          <input className="inv-desc" value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="e.g. 24&quot; Whirlpool WRT112CZJZ fridge" />
          <input className="inv-cost" type="number" inputMode="decimal" min="0" step="0.01" value={it.retail} onChange={(e) => setItem(i, 'retail', e.target.value)} placeholder="retail" />
          <input className="inv-amt" type="number" inputMode="decimal" min="0" step="0.01" value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} placeholder="price" />
          <button type="button" className="btn inv-del" onClick={() => removeRow(i)} aria-label="Remove line">×</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={addRow} style={{ marginBottom: 12 }}>+ Add line</button>

      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          Bundle discount
          <input style={{ width: 70 }} type="number" min="0" max="90" value={bundlePct} onChange={(e) => setBundlePct(e.target.value)} /> %
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          Cash deal (all-in, optional)
          <input style={{ width: 110 }} type="number" min="0" step="0.01" value={cashDeal} onChange={(e) => setCashDeal(e.target.value)} placeholder="e.g. 2650" />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={addHst} onChange={(e) => setAddHst(e.target.checked)} /> Add 13% HST
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={freeDelivery} onChange={(e) => setFreeDelivery(e.target.checked)} /> Include free delivery
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          Valid for
          <input style={{ width: 70 }} type="number" min="1" max="120" value={daysValid} onChange={(e) => setDaysValid(e.target.value)} /> days
        </label>
      </div>

      <div className="field">
        <label>Note to customer (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Shown on the quote" />
      </div>

      <div className="panel" style={{ background: 'var(--tint)', borderColor: 'var(--line-soft)' }}>
        <div className="summary-row"><span>Retail value</span><span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{fmt(retailSubtotal)}</span></div>
        <div className="summary-row"><span>Our price subtotal</span><span>{fmt(subtotal)}</span></div>
        {pct > 0 && <div className="summary-row"><span>Bundle discount ({pct}%)</span><span>−{fmt(subtotal - bundlePrice)}</span></div>}
        <div className="summary-row"><span>Bundle price</span><span>{fmt(bundlePrice)}</span></div>
        {addHst && <div className="summary-row"><span>HST (13%)</span><span>{fmt(hst)}</span></div>}
        <div className="summary-row total"><span>{cash != null ? 'Bundle total' : 'Total'}</span><span>{fmt(bundleTotal)}</span></div>
        {cash != null && <div className="summary-row total" style={{ color: 'var(--ok)' }}><span>Cash deal (all-in)</span><span>{fmt(cash)}</span></div>}
        {freeDelivery && <div className="hint" style={{ color: 'var(--ok)', marginTop: 4 }}>✓ Free delivery included</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn accent" disabled={busy}>
          {busy ? 'Saving…' : editQuote ? `Update & resend ${editQuote.number}` : 'Create & send quote'}
        </button>
      </div>
    </form>
  );
}

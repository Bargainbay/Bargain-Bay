'use client';
import { useState } from 'react';

const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BundleBuilder({ units = [], user = null }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]); // array of unit ids, in add order
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const byId = (id) => units.find((u) => u.id === id);
  const pickedUnits = picked.map(byId).filter(Boolean);

  const matches = q.trim().length >= 2
    ? units.filter((u) => !picked.includes(u.id) && u.search.includes(q.trim().toLowerCase())).slice(0, 10)
    : [];

  const add = (id) => { setPicked((xs) => (xs.includes(id) ? xs : [...xs, id])); setQ(''); };
  const remove = (id) => setPicked((xs) => xs.filter((x) => x !== id));

  const subtotal = pickedUnits.reduce((a, u) => a + (u.price || 0), 0);
  const retail = pickedUnits.reduce((a, u) => a + (u.compareAt > u.price ? u.compareAt : u.price), 0);
  const savings = Math.max(0, retail - subtotal);

  async function submit(e) {
    e.preventDefault();
    if (!pickedUnits.length) { setErr('Add at least one appliance to your bundle.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/quote-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, note, skus: picked })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not submit your request.'); return; }
      setDone(d);
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Request received 🎉</h2>
        <p style={{ fontSize: 14.5 }}>
          Thanks{name ? `, ${name.split(' ')[0]}` : ''}! We&apos;ve got your bundle and we&apos;ll email a custom package
          quote to <b>{email}</b> shortly — usually the same day. Your reference is <b>{done.number}</b>.
        </p>
        <a className="btn" href="/shop">Keep browsing →</a>
      </div>
    );
  }

  return (
    <div className="bundle-layout">
      <div>
        <div className="field">
          <label>Add appliances</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by type, brand, or model — e.g. fridge, Whirlpool…" />
          {matches.length > 0 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, maxHeight: 300, overflowY: 'auto' }}>
              {matches.map((u) => (
                <button type="button" key={u.id} onClick={() => add(u.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '9px 11px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span>{u.title}<span style={{ color: 'var(--muted)' }}> · {u.condition}</span></span>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--taupe-dark)', fontWeight: 600 }}>{fmt(u.price)}</span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && matches.length === 0 && <div className="hint">No matches in stock. Try another term, or mention it in the notes below.</div>}
        </div>

        <div className="panel" style={{ marginTop: 8 }}>
          <h2 style={{ marginTop: 0 }}>Your bundle{pickedUnits.length ? ` (${pickedUnits.length})` : ''}</h2>
          {pickedUnits.length === 0 && <p className="hint" style={{ margin: 0 }}>Nothing added yet — search above to start your package.</p>}
          {pickedUnits.map((u) => (
            <div className="summary-row" key={u.id} style={{ alignItems: 'center' }}>
              <span>{u.title}<span style={{ color: 'var(--muted)', fontSize: 12 }}> · {u.condition}</span></span>
              <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                {fmt(u.price)}
                <button type="button" className="btn" style={{ padding: '2px 9px' }} onClick={() => remove(u.id)} aria-label="Remove">×</button>
              </span>
            </div>
          ))}
          {pickedUnits.length > 0 && (
            <>
              <div className="summary-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}>
                <span>List total</span><span>{fmt(subtotal)}</span>
              </div>
              {savings > 0 && <div className="summary-row" style={{ color: 'var(--ok)' }}><span>Off retail</span><span>−{fmt(savings)}</span></div>}
              <p className="hint" style={{ marginTop: 8 }}>This is the list price. We&apos;ll come back with your <b>bundle</b> discount — packages save more.</p>
            </>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="panel bundle-form">
        <h2 style={{ marginTop: 0 }}>Get your quote</h2>
        {err && <div className="error-box">{err}</div>}
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="field">
          <label>Email *</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field">
          <label>Phone (optional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
        </div>
        <div className="field">
          <label>Anything else? (optional)</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery area, timing, an item you didn't see in stock…" />
        </div>
        <button className="btn accent block" disabled={busy || pickedUnits.length === 0}>
          {busy ? 'Sending…' : `Request my quote${pickedUnits.length ? ` (${pickedUnits.length})` : ''}`}
        </button>
        <p className="hint" style={{ marginTop: 8 }}>No obligation, nothing reserved. We&apos;ll email your custom package price.</p>
      </form>
    </div>
  );
}

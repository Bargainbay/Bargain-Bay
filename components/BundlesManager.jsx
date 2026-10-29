'use client';
import { useMemo, useState } from 'react';
import { money } from '../lib/constants';

// Package deals. Pick the units, type the package price. The package is on the
// site only while every unit in it is still for sale, and only when its price
// beats buying the units one by one.
const BLANK = { id: null, title: '', blurb: '', price: '', skus: [], active: true };

export default function BundlesManager({ initialBundles = [], options = [] }) {
  const [bundles, setBundles] = useState(initialBundles);
  const [form, setForm] = useState(BLANK);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const regular = form.skus.reduce((a, s) => a + (byId.get(s)?.price || 0), 0);
  const price = Number(form.price) || 0;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return options.filter((o) => !form.skus.includes(o.id) && `${o.id} ${o.title} ${o.category}`.toLowerCase().includes(t)).slice(0, 8);
  }, [q, options, form.skus]);

  async function call(method, body, qs = '') {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/bundles' + qs, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Something went wrong.'); return false; }
      setBundles(j.bundles || []);
      return true;
    } finally { setBusy(false); }
  }

  async function save(e) {
    e.preventDefault();
    if (await call('POST', form)) { setForm(BLANK); setQ(''); }
  }

  return (
    <div>
      <form className="panel" onSubmit={save} style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
        <h3 style={{ margin: 0 }}>{form.id ? 'Edit package' : 'New package'}</h3>
        <input placeholder="Name, e.g. Laundry pair — Samsung washer + dryer" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <input placeholder="One line for the shopper (optional)" value={form.blurb} onChange={(e) => setForm({ ...form, blurb: e.target.value })} />
        <div>
          <input placeholder="Search units to add (SKU, brand, model, washer…)" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.map((o) => (
            <button type="button" key={o.id} className="btn" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}
              onClick={() => { setForm({ ...form, skus: [...form.skus, o.id] }); setQ(''); }}>
              {o.title} · {o.id} · {money(o.price)}
            </button>
          ))}
        </div>
        {form.skus.map((s) => (
          <div key={s} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{byId.get(s)?.title || s} <small style={{ color: 'var(--muted)' }}>{s}{byId.get(s) ? '' : ' (not for sale now)'}</small></span>
            <span>{money(byId.get(s)?.price || 0)} <button type="button" className="btn" onClick={() => setForm({ ...form, skus: form.skus.filter((x) => x !== s) })}>Remove</button></span>
          </div>
        ))}
        <label>Package price (before tax)
          <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        </label>
        {form.skus.length > 0 && (
          <div style={{ fontSize: 14 }}>
            Separately: <b>{money(regular)}</b>
            {price > 0 && (price < regular
              ? <> · shopper saves <b>{money(regular - price)}</b> ({Math.round(((regular - price) / regular) * 100)}%)</>
              : <> · <span style={{ color: 'var(--red, #b00)' }}>no saving — this package would not be shown</span></>)}
          </div>
        )}
        {err && <div style={{ color: 'var(--red, #b00)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn accent" disabled={busy || form.skus.length < 2}>{form.id ? 'Save changes' : 'Create package'}</button>
          {form.id && <button type="button" className="btn" onClick={() => setForm(BLANK)}>Cancel</button>}
        </div>
      </form>

      <h3>Your packages</h3>
      {!bundles.length && <p style={{ color: 'var(--muted)' }}>None yet. If this stays empty after saving, run the schema migration from /admin.</p>}
      {bundles.map((b) => {
        const live = b.skus.every((s) => byId.has(s));
        return (
          <div key={b.id} className="panel" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b>{b.title}</b>
              <span>{money(b.price)} · {b.active ? (live ? 'on the site' : 'hidden — a unit has sold') : 'switched off'}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{b.skus.map((s) => byId.get(s)?.title || `${s} (gone)`).join(' + ')}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="btn" disabled={busy} onClick={() => { setForm({ ...b, price: String(b.price) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
              <button className="btn" disabled={busy} onClick={() => call('PATCH', { id: b.id, active: !b.active })}>{b.active ? 'Switch off' : 'Switch on'}</button>
              <button className="btn" disabled={busy} onClick={() => confirm('Delete this package?') && call('DELETE', null, `?id=${b.id}`)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

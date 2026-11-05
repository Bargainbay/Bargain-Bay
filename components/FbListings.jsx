'use client';
import { useEffect, useMemo, useState } from 'react';

// Every unit on sale as a ready-to-post Facebook Marketplace listing. Works on a phone:
// tap Copy for the title, the caption and the price, save the photos, paste into Marketplace.
// "Posted" ticks are kept in this browser only (a convenience, not a record).
const KEY = 'bb_fb_posted';

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

function CopyBtn({ label, text }) {
  const [done, setDone] = useState(null);
  return (
    <button type="button" className="btn small" onClick={async () => { setDone(await copy(text)); setTimeout(() => setDone(null), 1500); }}>
      {done === true ? 'Copied ✓' : done === false ? 'Copy failed' : label}
    </button>
  );
}

function Card({ l, posted, toggle }) {
  const [zipping, setZipping] = useState(false);
  const [note, setNote] = useState('');
  async function download() {
    setZipping(true); setNote('');
    try {
      const r = await fetch(`/api/admin/fb-listings/zip?sku=${encodeURIComponent(l.sku)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not build the zip.');
      const skipped = r.headers.get('X-Photos-Skipped');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob()); a.download = `${l.sku}-photos.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      if (skipped) setNote(`Photo ${skipped} could not be fetched - use Open on it.`);
    } catch (e) { setNote(e.message); }
    setZipping(false);
  }
  return (
    <div className="panel" style={{ opacity: posted ? 0.55 : 1, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{l.title}</strong>
        <label style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={posted} onChange={() => toggle(l.sku)} /> Posted
        </label>
      </div>
      <div style={{ fontSize: 12, color: '#666', margin: '2px 0 8px' }}>{l.sku} · {l.category} · ${l.price.toLocaleString('en-CA')} CAD</div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8 }}>
        {l.photos.map((p, i) => (
          <a key={i} href={p.url} target="_blank" rel="noreferrer" style={{ flex: '0 0 auto', textAlign: 'center', fontSize: 11, color: '#555' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" loading="lazy" style={{ width: 84, height: 84, objectFit: 'contain', background: '#fff', border: '1px solid #ddd', display: 'block' }} />
            {i + 1} · {p.kind === 'stock' ? 'stock' : 'actual unit'}
          </a>
        ))}
        {!l.photos.length && <span style={{ fontSize: 13, color: '#a00' }}>No photos yet</span>}
      </div>

      <textarea readOnly value={l.caption} rows={9} style={{ width: '100%', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} onFocus={(e) => e.target.select()} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <CopyBtn label="Copy title" text={l.title} />
        <CopyBtn label="Copy caption" text={l.caption} />
        <CopyBtn label="Copy price" text={String(l.price)} />
        <button type="button" className="btn small" onClick={download} disabled={zipping || !l.photos.length}>
          {zipping ? 'Preparing…' : `Download photos (${l.photos.length})`}
        </button>
      </div>
      {note && <div style={{ fontSize: 12, color: '#a00', marginTop: 6 }}>{note}</div>}
    </div>
  );
}

export default function FbListings({ listings }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [hidePosted, setHidePosted] = useState(true);
  const [posted, setPosted] = useState({});
  useEffect(() => { try { setPosted(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {} }, []);
  const toggle = (sku) => setPosted((p) => {
    const n = { ...p, [sku]: !p[sku] };
    if (!n[sku]) delete n[sku];
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {}
    return n;
  });
  const cats = useMemo(() => [...new Set(listings.map((l) => l.category).filter(Boolean))].sort(), [listings]);
  const shown = listings.filter((l) =>
    (!cat || l.category === cat) && (!hidePosted || !posted[l.sku]) &&
    (!q || `${l.title} ${l.sku} ${l.model} ${l.make}`.toLowerCase().includes(q.toLowerCase())));
  const left = listings.filter((l) => !posted[l.sku]).length;
  return (
    <div className="narrow">
      <h1 style={{ color: 'var(--charcoal)' }}>Facebook Marketplace listings</h1>
      <p style={{ fontSize: 14 }}>
        {listings.length} units on sale, {left} not yet posted. For each: copy the title, caption and price, download the photos,
        then post from the Facebook app. Prices match the site. Tick <b>Posted</b> when done. When a unit sells, take its Facebook listing down.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Search model, brand or SKU" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label style={{ fontSize: 13, alignSelf: 'center' }}>
          <input type="checkbox" checked={hidePosted} onChange={(e) => setHidePosted(e.target.checked)} /> Hide posted
        </label>
      </div>
      {shown.map((l) => <Card key={l.sku} l={l} posted={!!posted[l.sku]} toggle={toggle} />)}
      {!shown.length && <p>Nothing to show.</p>}
    </div>
  );
}

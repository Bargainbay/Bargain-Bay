'use client';
import { useEffect, useMemo, useState } from 'react';

// The pictures the storefront shows, in one place.
//
//   Stock photos — one per MODEL. The picture leads every card, the buy panel,
//   the OG tag and the Meta feed. A model with none shows placeholder art and is
//   left out of the feed, which is why "missing" is listed first.
//
//   Unit photos — our own pictures of one exact appliance, shown on its product
//   page after the stock picture.
//
// A pasted link is previewed here, in the browser, before it is saved: several
// manufacturer CDNs refuse server-side requests, so the page you are looking at
// is the only honest test that a link renders — and that it is the right machine.

const SRC = {
  missing: { label: 'No photo', bg: '#fdecea', fg: '#b3261e' },
  file: { label: 'On file', bg: '#eef2f6', fg: '#41505e' },
  upload: { label: 'Set here', bg: '#e6f4ea', fg: '#1e6b34' },
};

function Pill({ src }) {
  const s = SRC[src] || SRC.file;
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
}

function Thumb({ src, size = 64 }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  const box = { width: size, height: size, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', flex: 'none' };
  if (!src || bad) return <div style={{ ...box, display: 'grid', placeItems: 'center', fontSize: 11, color: '#999' }}>{src ? 'broken' : 'none'}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" style={{ ...box, objectFit: 'contain' }} onError={() => setBad(true)} />;
}

function ModelRow({ m, onChanged }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (fd) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/model-photos', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setLink(''); onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const saveLink = () => { const fd = new FormData(); fd.set('model', m.model); fd.set('url', link); send(fd); };
  const saveFile = (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return; const fd = new FormData(); fd.set('model', m.model); fd.set('photo', f); send(fd);
  };
  const clear = async () => {
    if (!confirm(`Remove the photo set here for ${m.model}? It falls back to the file, or to placeholder art.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/model-photos?model=' + encodeURIComponent(m.model), { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'Could not remove.');
      onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const trimmed = link.trim();
  return (
    <tr>
      <td><Thumb src={m.image} /></td>
      <td>
        <div style={{ fontWeight: 600 }}>{m.model}</div>
        <div className="hint" style={{ margin: 0 }}>{[m.make, m.category].filter(Boolean).join(' · ')} · {m.units} unit{m.units === 1 ? '' : 's'}</div>
        <div className="hint" style={{ margin: 0 }}>{(m.skus || []).join(', ')}</div>
      </td>
      <td><Pill src={m.source} /></td>
      <td style={{ minWidth: 300 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste image link (https://…)"
            style={{ flex: '1 1 180px', minWidth: 160, padding: '6px 8px' }} />
          <button className="btn primary" style={{ padding: '6px 12px' }} disabled={busy || !trimmed} onClick={saveLink}>Use link</button>
          <label className="btn" style={{ padding: '6px 12px', cursor: 'pointer' }}>
            Upload<input type="file" accept="image/*" hidden disabled={busy} onChange={saveFile} />
          </label>
          {m.source === 'upload' && <button className="btn" style={{ padding: '6px 12px' }} disabled={busy} onClick={clear}>Remove</button>}
        </div>
        {/^https:\/\//i.test(trimmed) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <Thumb src={trimmed} size={96} />
            <span className="hint" style={{ margin: 0 }}>Preview — check it loads and is the right appliance, then press Use link.</span>
          </div>
        )}
        {err && <div className="error-box" style={{ marginTop: 6 }}>{err}</div>}
      </td>
    </tr>
  );
}

function StockPhotos() {
  const [models, setModels] = useState(null);
  const [err, setErr] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [q, setQ] = useState('');
  const load = async () => {
    try {
      const r = await fetch('/api/admin/model-photos', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load.');
      setModels(d.models); setErr('');
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  const missing = useMemo(() => (models || []).filter((m) => m.source === 'missing').length, [models]);
  const shown = useMemo(() => (models || []).filter((m) => {
    if (onlyMissing && m.source !== 'missing') return false;
    const t = q.trim().toLowerCase();
    return !t || `${m.model} ${m.make} ${m.category} ${m.title}`.toLowerCase().includes(t);
  }), [models, onlyMissing, q]);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        One stock picture per model — it leads every card, the product page and the Meta feed. Models with no photo
        show placeholder art and are left out of the feed. A photo set here wins over the built-in list.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model, brand, type" style={{ padding: '7px 10px', minWidth: 220 }} />
        <label style={{ fontSize: 14 }}><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only models with no photo</label>
        {models && <span className="hint" style={{ margin: 0 }}>{missing} of {models.length} listed models have no photo</span>}
      </div>
      {err && <div className="error-box">{err}</div>}
      {!models && !err && <p className="hint">Loading…</p>}
      {models && !shown.length && <p className="hint">{onlyMissing && !q ? 'Every listed model has a photo. 🎉' : 'Nothing matches.'}</p>}
      {shown.length > 0 && (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th></th><th>Model</th><th>Photo</th><th>Set it</th></tr></thead>
          <tbody>{shown.map((m) => <ModelRow key={m.model} m={m} onChanged={load} />)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function UnitPhotos() {
  const [sku, setSku] = useState('');
  const [loaded, setLoaded] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const fetchFor = async (s) => {
    const r = await fetch('/api/admin/unit-photos?sku=' + encodeURIComponent(s), { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not load.');
    setPhotos(d.photos || []); setLoaded(s);
  };
  const load = async () => {
    const s = sku.trim(); if (!s) return;
    setBusy(true); setErr(''); setMsg('');
    try { await fetchFor(s); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const add = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const fd = new FormData(); fd.set('sku', loaded);
      files.forEach((f) => fd.append('photos', f));
      const r = await fetch('/api/admin/unit-photos', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setMsg(d.failed ? `${d.photos.length} added, ${d.failed} failed (too big or not an image).` : `${d.photos.length} added.`);
      await fetchFor(loaded);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const del = async (id) => {
    if (!confirm('Delete this photo? It comes off the product page.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/admin/unit-photos?id=' + id, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'Could not delete.');
      await fetchFor(loaded);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Our own pictures of one exact appliance. They show on its product page after the stock picture, labelled as the actual unit.
        Up to 8 per unit.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={sku} onChange={(e) => setSku(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Unit SKU, e.g. VD-MUN7G8GW7MA" style={{ padding: '7px 10px', minWidth: 260 }} />
        <button className="btn primary" disabled={busy || !sku.trim()} onClick={load}>Find</button>
      </div>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      {loaded && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {photos.map((p) => (
              <div key={p.id} style={{ textAlign: 'center' }}>
                <Thumb src={p.url} size={130} />
                <button className="btn" style={{ padding: '2px 10px', fontSize: 12, marginTop: 4 }} disabled={busy} onClick={() => del(p.id)}>Delete</button>
              </div>
            ))}
            {!photos.length && <p className="hint">No photos of {loaded} yet.</p>}
          </div>
          <label className="btn" style={{ padding: '7px 12px', cursor: 'pointer', display: 'inline-block', marginTop: 10 }}>
            Add photos<input type="file" accept="image/*" multiple hidden disabled={busy} onChange={add} />
          </label>
          <a className="btn" style={{ padding: '7px 12px', marginLeft: 8 }} target="_blank" rel="noopener noreferrer" href={'/product/' + encodeURIComponent(loaded)}>View product page</a>
        </div>
      )}
    </div>
  );
}

export default function PhotoManager() {
  const [tab, setTab] = useState('model');
  const tabBtn = (k, label) => (
    <button className={'btn' + (tab === k ? ' primary' : '')} style={{ padding: '7px 14px' }} onClick={() => setTab(k)}>{label}</button>
  );
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Photos</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {tabBtn('model', 'Stock photos by model')}
        {tabBtn('unit', 'Photos of a unit')}
      </div>
      {tab === 'model' ? <StockPhotos /> : <UnitPhotos />}
    </div>
  );
}

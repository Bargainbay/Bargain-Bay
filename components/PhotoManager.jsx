'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import DownloadPhoto from './DownloadPhoto';
import PhotoQueue from './PhotoQueue';
import { compressPhotos } from './photo-pick';
import { postUnitPhotos } from './unit-photo-upload';

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
      <td><Thumb src={m.image} />{m.image && <div style={{ marginTop: 4 }}><DownloadPhoto url={m.image} name={m.model} style={{ padding: '1px 8px', fontSize: 11 }}>⤓ Save</DownloadPhoto></div>}</td>
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
  // The unit is CHOSEN from matches, never typed in full: a SKU typed by hand is how
  // two photos ended up filed under a model number and belonging to nothing.
  const [text, setText] = useState('');
  const [matches, setMatches] = useState(null);   // null = not searched yet
  const [unit, setUnit] = useState(null);         // the unit picked
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const seq = useRef(0);

  // Search as they type (debounced); the newest answer wins.
  useEffect(() => {
    const t = text.trim();
    if (unit || t.length < 2) { setMatches(null); return; }
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await fetch('/api/admin/unit-photos?find=' + encodeURIComponent(t), { cache: 'no-store' });
        const d = await r.json();
        if (n === seq.current) setMatches(r.ok ? d.units || [] : []);
      } catch { if (n === seq.current) setMatches([]); }
    }, 250);
    return () => clearTimeout(h);
  }, [text, unit]);

  const fetchFor = async (sku) => {
    const r = await fetch('/api/admin/unit-photos?sku=' + encodeURIComponent(sku), { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not load.');
    setPhotos(d.photos || []);
  };
  const choose = async (u) => {
    setUnit(u); setText(''); setMatches(null); setErr(''); setMsg(''); setPhotos([]);
    setBusy(true);
    try { await fetchFor(u.sku); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const change = () => { setUnit(null); setPhotos([]); setErr(''); setMsg(''); };

  const add = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length || !unit) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const { ok, failed: unreadable } = await compressPhotos(files);
      const { saved, failed, error } = await postUnitPhotos(unit.sku, ok.map((p) => p.blob));
      ok.forEach((p) => URL.revokeObjectURL(p.url));
      const bad = failed + unreadable;
      if (!saved) throw new Error(error || "Those photos couldn't be read. Try taking them again.");
      setMsg(bad ? `${saved} added, ${bad} couldn't be (${error || "couldn't be read"}).` : `${saved} added.`);
      await fetchFor(unit.sku);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const del = async (id) => {
    if (!confirm('Delete this photo? It comes off the product page.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/admin/unit-photos?id=' + id, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not delete.');
      await fetchFor(unit.sku);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Our own pictures of one exact appliance. They show on its product page after the stock picture, labelled as the actual unit.
        Up to 8 per unit.
      </p>
      {!unit && (
        <div>
          <input className="pq-search" type="search" inputMode="search" autoComplete="off" value={text}
            onChange={(e) => setText(e.target.value)} placeholder="Type a brand, model or SKU, then tap the unit" />
          {matches && !matches.length && <p className="hint">No unit on the site matches that. Try fewer words.</p>}
          {matches && matches.length > 0 && (
            <ul className="pq-list pq-pick">
              {matches.map((u) => (
                <li key={u.sku}>
                  <button type="button" className="pq-pick-btn" onClick={() => choose(u)}>
                    <b>{[u.make, u.model].filter(Boolean).join(' ') || u.sku}</b>
                    <span><code>{u.sku}</code> · {[u.category, u.condition].filter(Boolean).join(' · ')}</span>
                    <span className={u.photos ? 'pq-has' : 'pq-none'}>{u.photos ? `${u.photos} photo${u.photos === 1 ? '' : 's'}` : 'no photos yet'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="hint" role="status">{msg}</div>}
      {unit && (
        <div>
          <div className="pq-chosen">
            <div><b>{[unit.make, unit.model].filter(Boolean).join(' ') || unit.sku}</b><br /><code>{unit.sku}</code></div>
            <button type="button" className="pq-btn" style={{ flex: 'none', minHeight: 44 }} disabled={busy} onClick={change}>Change unit</button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {photos.map((p) => (
              <div key={p.id} style={{ textAlign: 'center' }}>
                <Thumb src={p.url} size={130} />
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 4 }}>
                  <DownloadPhoto url={p.url} name={`${unit.sku}-${p.position + 1}`} style={{ padding: '2px 10px', fontSize: 12 }}>⤓ Save</DownloadPhoto>
                  <button className="btn" style={{ padding: '2px 10px', fontSize: 12 }} disabled={busy} onClick={() => del(p.id)}>Delete</button>
                </div>
              </div>
            ))}
            {!photos.length && !busy && <p className="hint">No photos of {unit.sku} yet.</p>}
          </div>
          <div className="pq-btns">
            <label className={'pq-btn pq-btn-main' + (busy ? ' pq-disabled' : '')}>
              📷 Take photo
              <input className="pq-file" type="file" accept="image/*" capture="environment" disabled={busy} onChange={add} />
            </label>
            <label className={'pq-btn' + (busy ? ' pq-disabled' : '')}>
              🖼 Choose from phone
              <input className="pq-file" type="file" accept="image/*" multiple disabled={busy} onChange={add} />
            </label>
            <a className="pq-btn" target="_blank" rel="noopener noreferrer" href={'/product/' + encodeURIComponent(unit.sku)}>View product page</a>
          </div>
          {busy && <p className="hint">Working…</p>}
        </div>
      )}
    </div>
  );
}

export default function PhotoManager() {
  // Opens on the list sales works down; the other two tabs are for looking up one thing.
  const [tab, setTab] = useState('queue');
  const [left, setLeft] = useState(null);
  const tabBtn = (k, label) => (
    <button className={'btn' + (tab === k ? ' primary' : '')} style={{ padding: '7px 14px' }} onClick={() => setTab(k)}>{label}</button>
  );
  return (
    <div className="panel pq-panel" style={{ marginTop: 18 }}>
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Photos</h1>
      <div className="pq-tabs">
        {tabBtn('queue', left == null ? 'To photograph' : `To photograph (${left})`)}
        {tabBtn('unit', 'Find a unit')}
        {tabBtn('model', 'Stock photos by model')}
      </div>
      {/* Kept mounted so the list and what was done this visit survive a look at another tab. */}
      <div hidden={tab !== 'queue'}><PhotoQueue onCount={setLeft} /></div>
      {tab === 'model' && <StockPhotos />}
      {tab === 'unit' && <UnitPhotos />}
    </div>
  );
}

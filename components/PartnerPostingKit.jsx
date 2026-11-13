'use client';
import { useEffect, useMemo, useState } from 'react';

// A lead generator's posting kit. Every item on sale as a ready-to-post Facebook listing (their own link and code in the words), a
// per-person "I posted this" that lives in the database, and the list of THEIR posted items that have sold and must come down.
// Nothing here talks to Facebook: they copy, save the photos and post by hand from their own phone.
const api = '/api/partner/posting';
const post = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const when = (iso) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}
function CopyBtn({ label, text }) {
  const [done, setDone] = useState(null);
  return <button type="button" className="btn small" onClick={async () => { setDone(await copy(text)); setTimeout(() => setDone(null), 1500); }}>{done === true ? 'Copied ✓' : done === false ? 'Copy failed' : label}</button>;
}

function Card({ l, posted, onPosted }) {
  const [zipping, setZipping] = useState(false);
  const [note, setNote] = useState('');
  async function download() {
    setZipping(true); setNote('');
    try {
      const r = await fetch(`${api}/zip?sku=${encodeURIComponent(l.sku)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not build the photos.');
      const skipped = r.headers.get('X-Photos-Skipped');
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${l.sku}-photos.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      if (skipped) setNote(`Photo ${skipped} could not be fetched. Tap it to open and save it.`);
    } catch (e) { setNote(e.message); }
    setZipping(false);
  }
  return (
    <div className="panel" style={{ opacity: posted ? 0.6 : 1, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{l.isNew && <span style={{ background: '#15803d', color: '#fff', fontSize: 11, padding: '1px 6px', borderRadius: 4, marginRight: 6 }}>NEW</span>}{l.title}</strong>
        <label style={{ fontSize: 13, whiteSpace: 'nowrap' }}><input type="checkbox" checked={posted} onChange={(e) => onPosted(l.sku, e.target.checked)} /> I posted this</label>
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
        <button type="button" className="btn small" onClick={download} disabled={zipping || !l.photos.length}>{zipping ? 'Preparing…' : `Download photos (${l.photos.length})`}</button>
      </div>
      {note && <div style={{ fontSize: 12, color: '#a00', marginTop: 6 }}>{note}</div>}
    </div>
  );
}

export default function PartnerPostingKit() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [hidePosted, setHidePosted] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => { const r = await fetch(api).then((x) => x.json()).catch(() => ({})); setData(r.listings ? r : { stockOk: false, listings: [], posted: {}, takeDown: [], error: r.error }); };
  useEffect(() => { load(); }, []);

  async function mark(sku, on) {
    setMsg('');
    const r = await post({ sku, action: on ? 'posted' : 'unposted' });
    if (!r.ok) setMsg(r.error || 'Could not save that.');
    load();
  }
  async function takenDown(sku) { setMsg(''); const r = await post({ sku, action: 'taken_down' }); if (!r.ok) setMsg(r.error || 'Could not save that.'); load(); }

  const cats = useMemo(() => [...new Set((data?.listings || []).map((l) => l.category).filter(Boolean))].sort(), [data]);
  if (!data) return <div className="panel"><p className="hint" style={{ margin: 0 }}>Loading the posting kit…</p></div>;
  const posted = data.posted || {};
  const shown = data.listings.filter((l) => (!cat || l.category === cat) && (!hidePosted || !posted[l.sku]) && (!onlyNew || l.isNew)
    && (!q || `${l.title} ${l.sku} ${l.model} ${l.make}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Posting kit</h2>
        {data.error && <p style={{ color: '#b91c1c' }}>{data.error}</p>}
        {!data.stockOk ? (
          <p style={{ color: '#b45309', marginBottom: 0 }}>We cannot check the stock right now, so the kit is paused. Please try again in a few minutes. Do not post anything that you are not sure is still for sale.</p>
        ) : (
          <p className="hint" style={{ marginBottom: 0 }}>Stock as of {when(data.asOf)}. Refresh before you post: items sell during the day. Copy the words, save the photos, post on your own Facebook, then tick <b>I posted this</b>. Do not change the price, the condition or the warranty.</p>
        )}
      </div>

      {data.stockOk && data.takeDown.length > 0 && (
        <div className="panel" style={{ marginBottom: 12, borderLeft: '4px solid #b91c1c' }}>
          <h3 style={{ marginTop: 0, fontSize: 16, color: '#b91c1c' }}>Take these down now ({data.takeDown.length})</h3>
          <p className="hint" style={{ marginTop: 0 }}>You posted these and they are no longer for sale. Delete the Facebook listing, then press <b>Taken down</b>.</p>
          {data.takeDown.map((t) => (
            <div key={t.sku} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>{t.title} <span className="hint">({t.sku}) · sold or held since {when(t.goneAt)}</span></span>
              <button className="btn" onClick={() => takenDown(t.sku)}>Taken down</button>
            </div>
          ))}
        </div>
      )}
      {data.stockOk && data.takeDown.length === 0 && Object.keys(posted).length > 0 && <p className="hint" style={{ margin: '0 2px 10px' }}>Nothing you posted has sold. 👍</p>}
      {msg && <div className="panel" style={{ marginBottom: 10 }}>{msg}</div>}

      {data.stockOk && (<>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input placeholder="Search model, brand or SKU" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <label style={{ fontSize: 13, alignSelf: 'center' }}><input type="checkbox" checked={hidePosted} onChange={(e) => setHidePosted(e.target.checked)} /> Hide what I posted</label>
          <label style={{ fontSize: 13, alignSelf: 'center' }}><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> New since last night ({data.newCount})</label>
        </div>
        {shown.map((l) => <Card key={l.sku} l={l} posted={!!posted[l.sku]} onPosted={mark} />)}
        {!shown.length && <p className="hint">Nothing to show.</p>}
      </>)}
    </div>
  );
}

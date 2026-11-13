'use client';
import { useEffect, useMemo, useState } from 'react';

// A lead generator's posting kit. Every item on sale as a ready-to-post Facebook listing (their own link and code in the words), a
// per-person "Mark as posted" that lives in the database, and the list of THEIR posted items that have sold and must come down.
// Nothing here talks to Facebook: they copy, save the photos and post by hand from their own phone.
const api = '/api/partner/posting';
const post = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const when = (iso) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const GREEN = '#15803d';
const money = (n) => `$${Number(n).toLocaleString('en-CA')}`;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}
function CopyBtn({ label, text, primary }) {
  const [done, setDone] = useState(null);
  return <button type="button" className={primary ? 'btn btn-primary' : 'btn small'} style={primary ? { flex: 1 } : undefined} onClick={async () => { setDone(await copy(text)); setTimeout(() => setDone(null), 1500); }}>{done === true ? 'Copied ✓' : done === false ? 'Copy failed' : label}</button>;
}

function Steps() {
  const steps = [['1', 'Pick an item', 'Stock is updated every night'], ['2', 'Copy and save', 'Copy the words, download the photos'], ['3', 'Post it, then tick it', 'Post on your Facebook, then press Mark as posted']];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, margin: '12px 0 4px' }}>
      {steps.map(([n, h, d]) => (
        <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ flex: '0 0 26px', height: 26, borderRadius: 13, background: '#2e2d2b', color: '#fff', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
          <span><b style={{ fontSize: 14 }}>{h}</b><br /><span className="hint" style={{ fontSize: 12.5 }}>{d}</span></span>
        </div>
      ))}
    </div>
  );
}

function Card({ l, posted, onPosted }) {
  const [zipping, setZipping] = useState(false);
  const [note, setNote] = useState('');
  const [pic, setPic] = useState(0);
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
  const hero = l.photos[pic] || l.photos[0];
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e0', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: posted ? 0.72 : 1 }}>
      <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#f6f6f3' }}>
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero.url} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a00', fontSize: 13 }}>No photos yet</div>}
        {l.isNew && <span style={{ position: 'absolute', top: 8, left: 8, background: GREEN, color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>NEW</span>}
        {posted && <span style={{ position: 'absolute', top: 8, right: 8, background: '#2e2d2b', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>Posted ✓</span>}
        <span style={{ position: 'absolute', bottom: 8, right: 8, background: '#2e2d2b', color: '#fff', fontSize: 15, fontWeight: 700, padding: '3px 10px', borderRadius: 8 }}>{money(l.price)}</span>
      </div>
      {l.photos.length > 1 && (
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', padding: '6px 8px 0' }}>
          {l.photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p.url} alt="" loading="lazy" onClick={() => setPic(i)} title={p.kind === 'stock' ? 'Stock photo' : 'Photo of the actual unit'} style={{ flex: '0 0 auto', width: 44, height: 44, objectFit: 'contain', background: '#fff', border: i === pic ? '2px solid #2e2d2b' : '1px solid #ddd', borderRadius: 6, cursor: 'pointer' }} />
          ))}
        </div>
      )}
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{l.title}</div>
          <div className="hint" style={{ fontSize: 12, marginTop: 2 }}>{l.category} · {l.sku}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <CopyBtn primary label="Copy the words" text={l.caption} />
          <button type="button" className="btn" onClick={download} disabled={zipping || !l.photos.length}>{zipping ? 'Preparing…' : `Photos (${l.photos.length})`}</button>
        </div>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#555' }}>See the words, title and price</summary>
          <textarea readOnly value={l.caption} rows={8} style={{ width: '100%', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', marginTop: 6 }} onFocus={(e) => e.target.select()} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <CopyBtn label="Copy title" text={l.title} />
            <CopyBtn label="Copy price" text={String(l.price)} />
          </div>
        </details>
        <button type="button" onClick={() => onPosted(l.sku, !posted)} className={posted ? 'btn' : 'btn btn-primary'} style={{ marginTop: 'auto', ...(posted ? { color: GREEN, borderColor: GREEN, fontWeight: 700 } : {}) }}>{posted ? '✓ Posted. Tap to undo' : 'Mark as posted'}</button>
        {note && <div style={{ fontSize: 12, color: '#a00' }}>{note}</div>}
      </div>
    </div>
  );
}

export default function PartnerPostingKit() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [view, setView] = useState('todo');
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
  const inView = (l) => (view === 'todo' ? !posted[l.sku] : view === 'new' ? l.isNew && !posted[l.sku] : view === 'posted' ? !!posted[l.sku] : true);
  const counts = {
    todo: data.listings.filter((l) => !posted[l.sku]).length,
    new: data.listings.filter((l) => l.isNew && !posted[l.sku]).length,
    posted: data.listings.filter((l) => posted[l.sku]).length,
    all: data.listings.length
  };
  const shown = data.listings.filter((l) => (!cat || l.category === cat) && inView(l)
    && (!q || `${l.title} ${l.sku} ${l.model} ${l.make}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Posting kit</h2>
        {data.error && <p style={{ color: '#b91c1c' }}>{data.error}</p>}
        {!data.stockOk ? (
          <p style={{ color: '#b45309', marginBottom: 0 }}>We cannot check the stock right now, so the kit is paused. Please try again in a few minutes. Do not post anything that you are not sure is still for sale.</p>
        ) : (
          <>
            <p className="hint" style={{ margin: 0 }}>Stock as of {when(data.asOf)}. Refresh the page before you post, because items sell during the day. Do not change the price, the condition or the warranty.</p>
            <Steps />
          </>
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[['todo', 'To post'], ['new', 'New since last night'], ['posted', 'Posted'], ['all', 'All']].map(([k, label]) => (
            <button key={k} type="button" className={view === k ? 'btn btn-primary' : 'btn'} onClick={() => setView(k)}>{label} ({counts[k]})</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input placeholder="Search model, brand or SKU" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 14, alignItems: 'stretch' }}>
          {shown.map((l) => <Card key={l.sku} l={l} posted={!!posted[l.sku]} onPosted={mark} />)}
        </div>
        {!shown.length && <p className="hint">Nothing to show here.</p>}
      </>)}
    </div>
  );
}

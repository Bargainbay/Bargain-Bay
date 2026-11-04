'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compressPhotos } from './photo-pick';
import { postUnitPhotos } from './unit-photo-upload';

// The list sales works down: every unit on sale with no picture of the actual
// machine. Built for a phone held in one hand at the rack.
//
//   find the unit -> tap Photograph -> Take photo (as many times as needed) ->
//   Save -> it drops off the list and the next one is right there.
//
// Two real buttons for the picker, never `capture` on the multi-select input:
// on iOS `capture` makes an input camera-ONLY and ignores `multiple`, so a rep
// who shot the unit with the normal Camera app could not attach it. One button
// opens the camera (one shot at a time, repeatable), the other the library.
//
// Photos are shrunk on the phone first (photo-pick) — several MB each otherwise,
// and the upload is on warehouse wifi at best. Failures are counted and shown,
// never swallowed.

const MAX = 8;

function Thumb({ src }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (!src || bad) return <div className="pq-thumb pq-thumb-empty">no photo</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="pq-thumb" src={src} alt="" onError={() => setBad(true)} />;
}

function Capture({ unit, onSaved, onCancel }) {
  const [shots, setShots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  // Preview URLs are object URLs; hand them back when the sheet goes away.
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  async function pick(e) {
    const files = [...(e.target.files || [])].slice(0, MAX - shots.length);
    e.target.value = '';
    if (!files.length) return;
    setErr(''); setBusy(true);
    const { ok, failed } = await compressPhotos(files);
    setShots((p) => [...p, ...ok].slice(0, MAX));
    setBusy(false);
    if (failed) setErr(`${failed} photo${failed === 1 ? '' : 's'} couldn't be read. Try taking it again.`);
  }

  async function save() {
    if (!shots.length) { setErr('Take a photo first.'); return; }
    setBusy(true); setErr('');
    const { saved, failed, error } = await postUnitPhotos(unit.sku, shots.map((s) => s.blob));
    if (!saved) {
      // The shots stay on screen: a failed upload must never cost the rep the pictures.
      setErr(`${error || 'Could not save.'} Your photos are still here. Tap Save to try again.`);
      setBusy(false);
      return;
    }
    onSaved(saved, failed);
  }

  const room = MAX - shots.length;
  return (
    <div className="pq-capture">
      <div className="pq-btns">
        <label className={'pq-btn pq-btn-main' + (busy || !room ? ' pq-disabled' : '')}>
          📷 Take photo
          <input className="pq-file" type="file" accept="image/*" capture="environment" disabled={busy || !room} onChange={pick} />
        </label>
        <label className={'pq-btn' + (busy || !room ? ' pq-disabled' : '')}>
          🖼 Choose from phone
          <input className="pq-file" type="file" accept="image/*" multiple disabled={busy || !room} onChange={pick} />
        </label>
      </div>
      <p className="pq-hint">
        {shots.length
          ? `${shots.length} of ${MAX} ready. Tap a photo to remove it.`
          : 'Front, the sides, any dents or marks, the inside. Up to 8.'}
      </p>
      {shots.length > 0 && (
        <div className="pq-shots">
          {shots.map((s, i) => (
            <button type="button" key={s.url} disabled={busy} title="Remove"
              onClick={() => { URL.revokeObjectURL(s.url); setShots((x) => x.filter((_, n) => n !== i)); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`Photo ${i + 1}`} />
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}
      {err && <div className="error-box">{err}</div>}
      <div className="pq-btns">
        <button type="button" className="pq-btn pq-btn-save" disabled={busy || !shots.length} onClick={save}>
          {busy ? 'Working…' : `Save ${shots.length || ''} photo${shots.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="pq-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function PhotoQueue({ onCount }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);       // sku with the camera sheet open
  const [done, setDone] = useState([]);         // { sku, label, n } saved this visit
  const [note, setNote] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/admin/unit-photos?queue=1', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the list.');
      setData(d); setErr('');
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (data && onCount) onCount(data.units.length); }, [data, onCount]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const units = data?.units || [];
    if (!t) return units;
    return units.filter((u) => `${u.sku} ${u.make} ${u.model} ${u.category} ${u.title} ${u.spot || ''}`.toLowerCase().includes(t));
  }, [data, q]);

  function saved(unit, n, failed) {
    setOpen(null);
    setDone((d) => [{ sku: unit.sku, label: [unit.make, unit.model].filter(Boolean).join(' ') || unit.sku, n }, ...d]);
    setNote(failed ? `${unit.sku}: ${n} saved, ${failed} couldn't be (too big or not an image).` : '');
    // Drop it from the list at once; the next load confirms it from the server.
    setData((d) => d && ({ ...d, withPhotos: d.withPhotos + 1, units: d.units.filter((u) => u.sku !== unit.sku) }));
  }

  if (err) return <div className="error-box">{err} <button className="btn" onClick={load}>Try again</button></div>;
  if (!data) return <p className="hint">Loading…</p>;

  const left = data.units.length;
  const pct = data.total ? Math.round((data.withPhotos / data.total) * 100) : 100;
  return (
    <div className="pq">
      <div className="pq-progress">
        <div className="pq-progress-top">
          <b>{data.withPhotos} of {data.total}</b> units on sale have photos
          <span className="pq-left">{left ? `${left} to go` : 'All done'}</span>
        </div>
        <div className="pq-bar"><i style={{ width: pct + '%' }} /></div>
        {done.length > 0 && <div className="pq-done-count">✓ {done.length} done this visit</div>}
      </div>

      {note && <div className="hint" role="status">{note}</div>}

      <input className="pq-search" type="search" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search brand, model, SKU or spot" />

      {!left && <p className="hint">Every unit on sale has a photo. 🎉</p>}
      {left > 0 && !shown.length && <p className="hint">Nothing matches that search.</p>}

      <ul className="pq-list">
        {shown.map((u) => (
          <li key={u.sku} className={'pq-item' + (open === u.sku ? ' pq-item-open' : '')}>
            <div className="pq-row">
              <Thumb src={u.image} />
              <div className="pq-info">
                <div className="pq-title">{[u.make, u.model].filter(Boolean).join(' ') || u.title || u.sku}</div>
                <div className="pq-meta">{[u.category, u.condition].filter(Boolean).join(' · ')}</div>
                <div className="pq-meta">
                  <code>{u.sku}</code>{u.spot && <span className="pq-spot">📍 {u.spot}</span>}
                </div>
              </div>
            </div>
            {open === u.sku
              ? <Capture unit={u} onSaved={(n, f) => saved(u, n, f)} onCancel={() => setOpen(null)} />
              : <button type="button" className="pq-btn pq-btn-main pq-go" onClick={() => { setOpen(u.sku); setNote(''); }}>📷 Photograph this unit</button>}
          </li>
        ))}
      </ul>

      {done.length > 0 && (
        <details className="pq-donelist">
          <summary>Done this visit ({done.length})</summary>
          <ul>
            {done.map((d) => (
              <li key={d.sku}>✓ {d.label} <code>{d.sku}</code> · {d.n} photo{d.n === 1 ? '' : 's'}{' '}
                <a href={'/product/' + encodeURIComponent(d.sku)} target="_blank" rel="noopener noreferrer">View</a></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

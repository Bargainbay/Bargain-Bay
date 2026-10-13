'use client';
import { useEffect, useState, useCallback } from 'react';
import DownloadPhoto from './DownloadPhoto';
import { compressPhotos } from './photo-pick';

// Pictures of a part: take one with the phone camera, or pick from the library,
// and download any of them. Two buttons and no `capture` on the library input -
// on iOS `capture` makes an input camera-ONLY and ignores `multiple`.
//
// Used two ways: with a `partId` it loads, uploads and deletes straight away
// (the part's card); with `onPending` it only collects files for the booking
// form, which uploads them once the part exists.
export default function PartPhotos({ partId, label = 'part', onPending, canDelete = true }) {
  const [photos, setPhotos] = useState([]);
  const [pending, setPending] = useState([]); // { blob, url }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!partId) return;
    try {
      const r = await fetch(`/api/admin/part-photos?partId=${partId}`, { cache: 'no-store' });
      const d = await r.json();
      if (r.ok) setPhotos(d.photos || []);
    } catch { /* leave as is */ }
  }, [partId]);
  useEffect(() => { load(); }, [load]);

  async function pick(e) {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr('');
    try {
      const { ok, failed } = await compressPhotos(files);
      if (failed) setErr(`${failed} photo${failed === 1 ? '' : 's'} couldn't be read.`);
      if (!partId) {
        const next = [...pending, ...ok];
        setPending(next); onPending?.(next.map((p) => p.blob));
        return;
      }
      const fd = new FormData(); fd.set('partId', String(partId));
      ok.forEach((p, i) => fd.append('photos', p.blob, `part-${i}.jpg`));
      const r = await fetch('/api/admin/part-photos', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save the photo.');
      if (d.failed) setErr(`${d.failed} didn't save (too big or not a picture).`);
      await load();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  function dropPending(i) {
    const next = pending.filter((_, k) => k !== i);
    setPending(next); onPending?.(next.map((p) => p.blob));
  }
  async function del(id) {
    if (!confirm('Delete this photo?')) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/part-photos?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Could not delete.');
      await load();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  const box = { width: 96, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line-soft)' };
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {photos.map((p) => (
          <div key={p.id} style={{ textAlign: 'center' }}>
            <a href={p.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Photo of ${label}`} style={box} />
            </a>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 4 }}>
              <DownloadPhoto url={p.url} name={label} style={{ padding: '1px 8px', fontSize: 12 }}>⤓ Save</DownloadPhoto>
              {canDelete && <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: 12 }} disabled={busy} onClick={() => del(p.id)}>Delete</button>}
            </div>
          </div>
        ))}
        {pending.map((p, i) => (
          <div key={p.url} style={{ textAlign: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" style={box} />
            <div><button type="button" className="btn" style={{ padding: '1px 8px', fontSize: 12, marginTop: 4 }} onClick={() => dropPending(i)}>Remove</button></div>
          </div>
        ))}
      </div>
      <div className="pt-row" style={{ marginTop: 8 }}>
        <label className="btn" style={{ cursor: 'pointer' }}>
          {busy ? 'Working…' : '📷 Take photo'}
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={pick} />
        </label>
        <label className="btn" style={{ cursor: 'pointer' }}>
          Choose from library
          <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={pick} />
        </label>
      </div>
      {err && <div className="error-box" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

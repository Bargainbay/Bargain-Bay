'use client';
import { useState } from 'react';

// The photos on one warranty claim, with an upload when the viewer may add. Both sides see every photo of a
// claim (the seller has to see the fault). `base` is the route that serves and accepts them.
export default function ClaimPhotos({ claim, base, canAdd, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function upload(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      fd.append('claimId', claim.id);
      files.forEach((f) => fd.append('photos', f));
      const res = await fetch(base, { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || 'That did not work.');
      else if (d.refused?.length) setMsg(d.refused.map((r) => `${r.name}: ${r.problems.join(' ')}`).join(' · '));
      if (res.ok && d.saved?.length) onDone?.();
    } catch { setMsg('Network error — please try again.'); } finally { setBusy(false); }
  }
  const photos = claim.photos || [];
  return (
    <div style={{ marginTop: 8 }}>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {photos.map((p) => (
            <a key={p.id} href={`${base}?id=${p.id}`} target="_blank" rel="noreferrer" title={`${p.side === 'vendor' ? 'Seller' : 'Bargain Bay'}${p.caption ? ` — ${p.caption}` : ''}`}>
              <img src={`${base}?id=${p.id}`} alt={p.caption || 'Claim photo'} width={84} height={84} style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border, #ddd)' }} />
            </a>
          ))}
        </div>)}
      {canAdd && (
        <label style={{ display: 'inline-block', marginTop: 6, fontSize: 13 }}>
          <span className="btn" style={{ cursor: 'pointer' }}>{busy ? 'Uploading…' : 'Add photos'}</span>
          <input type="file" accept="image/*" multiple disabled={busy} onChange={upload} style={{ display: 'none' }} />
        </label>)}
      {msg && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{msg}</div>}
    </div>
  );
}

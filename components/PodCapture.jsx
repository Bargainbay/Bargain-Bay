'use client';
import { useEffect, useRef, useState } from 'react';

// Downscale a phone photo to a small JPEG so the upload stays well under the
// serverless body limit (and saves Blob storage).
async function compress(file) {
  const img = await createImageBitmap(file);
  const max = 1400;
  let { width, height } = img;
  if (width > max || height > max) {
    const s = Math.min(max / width, max / height);
    width = Math.round(width * s); height = Math.round(height * s);
  }
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').drawImage(img, 0, 0, width, height);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.75));
}

export default function PodCapture({ order, onDelivered }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const [photos, setPhotos] = useState([]); // { blob, url }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
    const pt = (e) => {
      const r = c.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return [t.clientX - r.left, t.clientY - r.top];
    };
    const down = (e) => { drawing.current = true; signed.current = true; const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = (e) => { if (!drawing.current) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
    const up = () => { drawing.current = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  function clearSig() {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    signed.current = false;
  }

  async function onPick(e) {
    setErr('');
    const files = [...e.target.files].slice(0, 8);
    const out = [];
    for (const f of files) { try { out.push({ blob: await compress(f), url: URL.createObjectURL(f) }); } catch { /* skip unreadable */ } }
    setPhotos((p) => [...p, ...out].slice(0, 8));
    e.target.value = '';
  }

  async function submit() {
    if (!signed.current) { setErr('Please capture the customer signature.'); return; }
    setBusy(true); setErr('');
    try {
      const sigBlob = await new Promise((r) => canvasRef.current.toBlob(r, 'image/png'));
      const fd = new FormData();
      fd.append('orderId', String(order.id));
      fd.append('signature', sigBlob, 'signature.png');
      photos.forEach((p, i) => fd.append('photos', p.blob, `photo-${i}.jpg`));
      const res = await fetch('/api/driver/pod', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Upload failed'); return; }
      onDelivered();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
      <b style={{ fontSize: 14 }}>Complete delivery</b>
      {err && <div className="error-box" style={{ marginTop: 6 }}>{err}</div>}

      <div style={{ marginTop: 8 }}>
        <label className="btn" style={{ cursor: 'pointer' }}>
          📷 Add photos
          <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={onPick} />
        </label>
        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {photos.map((p, i) => (
              <img key={i} src={p.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="hint" style={{ marginBottom: 4 }}>Customer signature</div>
        <canvas
          ref={canvasRef}
          width={300}
          height={130}
          style={{ border: '1px dashed var(--line)', borderRadius: 8, touchAction: 'none', background: '#fff', maxWidth: '100%' }}
        />
        <div style={{ marginTop: 4 }}>
          <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={clearSig}>Clear</button>
        </div>
      </div>

      <button className="btn accent" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>
        {busy ? 'Uploading…' : 'Submit POD & mark delivered'}
      </button>
    </div>
  );
}

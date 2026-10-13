'use client';
import { useState } from 'react';

// "Save this picture". Pictures that live on our own domain (/api/photo, parts,
// claims, listings, /model-photos) are downloaded by the server with a proper
// filename (?download=1). A manufacturer's CDN is somebody else's server: we try
// to fetch it and save the file, and if that CDN refuses the browser (most do not
// send CORS headers) we open the picture in a new tab instead of doing nothing.
export function downloadUrl(url) {
  return url + (url.includes('?') ? '&' : '?') + 'download=1';
}

export default function DownloadPhoto({ url, name = 'photo', children = '⤓ Download', className = 'btn', style, title = 'Download this picture' }) {
  const [busy, setBusy] = useState(false);
  if (!url) return null;
  const local = url.startsWith('/') && !url.startsWith('//');
  if (local) {
    return <a className={className} style={style} href={downloadUrl(url)} download title={title}>{children}</a>;
  }
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('refused');
      const blob = await res.blob();
      const ext = /png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${String(name).replace(/[^\w.-]+/g, '-').slice(0, 60) || 'photo'}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch {
      window.open(url, '_blank', 'noopener');
    } finally { setBusy(false); }
  }
  return <button type="button" className={className} style={style} onClick={save} disabled={busy} title={title}>{busy ? 'Saving…' : children}</button>;
}

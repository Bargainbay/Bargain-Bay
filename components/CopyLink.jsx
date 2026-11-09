'use client';
import { useState } from 'react';

export default function CopyLink({ link }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt('Copy this link:', link); }
  }
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 220 }} />
      <button type="button" className="btn btn-primary" onClick={copy}>{done ? 'Copied' : 'Copy link'}</button>
    </div>
  );
}

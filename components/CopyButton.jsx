'use client';
import { useState } from 'react';

export default function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn" style={{ fontSize: 12.5 }}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked: the text is on screen */ }
      }}>{done ? 'Copied' : label}</button>
  );
}

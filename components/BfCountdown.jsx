'use client';
// Live countdown to the end of the sale. The server renders the plain end date (no clock, so the HTML never goes
// stale in a cache and never mismatches on hydration); the digits appear once the browser has mounted.
import { useEffect, useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');

export default function BfCountdown({ endMs, fallback }) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, endMs - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endMs]);

  if (left == null) return <span className="bfh-count-fallback">{fallback}</span>;
  if (left <= 0) return <span className="bfh-count-fallback">The sale has ended</span>;
  const s = Math.floor(left / 1000);
  const parts = [['Days', Math.floor(s / 86400)], ['Hrs', Math.floor((s % 86400) / 3600)], ['Min', Math.floor((s % 3600) / 60)], ['Sec', s % 60]];
  return (
    <div className="bfh-count" role="timer" aria-label={`${parts[0][1]} days ${parts[1][1]} hours left`}>
      {parts.map(([label, v]) => (
        <div key={label} className="bfh-count-cell"><b>{pad(v)}</b><small>{label}</small></div>
      ))}
    </div>
  );
}

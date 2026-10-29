'use client';
import { useEffect, useState } from 'react';

// The red count beside "Resellers" in the admin nav: applications waiting for an answer. Fetched
// after the page loads, like the clock pill, so the shared nav needs no data of its own. It renders
// nothing at zero and nothing on any failure -- a badge that errors must never get in the way.
export default function PendingBadge({ url = '/api/admin/members?count=1' }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setN(Number(d?.pending) || 0); })
      .catch(() => {});
    load();
    const t = setInterval(load, 120000);
    return () => { live = false; clearInterval(t); };
  }, [url]);
  if (!n) return null;
  return <span className="nav-badge" aria-label={n + ' waiting'}>{n}</span>;
}

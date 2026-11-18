'use client';
import { useEffect, useState } from 'react';

// The Team button on the driver's stop list, with the unread count. It opens the board
// INSIDE the app (/driver/team). The count is fetched after load and renders nothing at
// zero or on any failure — no signal must never break the stop list.
export default function DriverTeamLink() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      fetch('/api/team?summary=1', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (live && d) setN(Number(d.total) || 0); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    document.addEventListener('visibilitychange', load);
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, []);
  return (
    <a href="/driver/team" className="drv-btn" style={{ alignSelf: 'center', position: 'relative' }}>
      💬 Team{n > 0 && <span className="nav-badge" style={{ marginLeft: 6 }}>{n > 99 ? '99+' : n}</span>}
    </a>
  );
}

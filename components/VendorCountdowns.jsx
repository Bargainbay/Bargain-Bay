'use client';
// Live countdowns for the orders that need the vendor, most urgent first. The browser ticks, but the
// deadlines are the server's (serverNow corrects for a wrong clock) and the strikes are judged there.
import { useEffect, useState } from 'react';

const tone = (left) => (left < 0 ? 'over' : left < 6 ? 'warn' : 'ok');
const label = (left) => {
  if (left < 0) return `OVERDUE by ${Math.floor(-left)} h ${Math.round((-left % 1) * 60)} m`;
  return `${Math.floor(left)} h ${Math.round((left % 1) * 60)} m left`;
};

export default function VendorCountdowns({ orders, serverNow }) {
  const skew = new Date(serverNow) - Date.now();
  const [now, setNow] = useState(() => new Date(Date.now() + skew));
  useEffect(() => { const t = setInterval(() => setNow(new Date(Date.now() + skew)), 30000); return () => clearInterval(t); }, [skew]);
  const rows = orders
    .filter((o) => o.status === 'awaiting_accept' || o.status === 'accepted')
    .map((o) => {
      const accept = o.status === 'awaiting_accept';
      const deadline = accept ? o.acceptBy : o.readyBy;
      return { o, accept, left: (new Date(deadline) - now) / 3600000 };
    })
    .sort((a, b) => a.left - b.left);
  if (!rows.length) return <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>No orders need you right now. When one is paid, its clocks appear here.</p>;
  return (
    <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
      <thead><tr><th>Order</th><th>Next step</th><th>Time left</th><th></th></tr></thead>
      <tbody>{rows.map(({ o, accept, left }) => {
        const t = tone(left);
        return (
          <tr key={o.id}>
            <td><b>{o.orderNumber}</b> <span style={{ color: 'var(--muted)', fontSize: 12 }}>Lane {o.lane}</span></td>
            <td>{accept ? 'Accept the order' : o.lane === 'C' ? 'Ship it and add tracking' : 'Make it ready'}</td>
            <td><span className={`pill ${t === 'ok' ? 'ok' : 'warn'}`}
              style={t === 'over' ? { background: 'var(--dangerbg)', color: 'var(--danger)' } : undefined}>{label(left)}</span></td>
            <td><a href="/vendor/orders">Open →</a></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

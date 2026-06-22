'use client';
import { useEffect, useRef, useState } from 'react';

// Live order tracking: while an order is in flight, poll its status every 30s
// and refresh the page when it advances (e.g. driver marks Out for Delivery or
// Delivered) — so a customer watching the tracker sees it move without reloading.
export default function OrderLiveRefresh({ orderNumber, token, status }) {
  const initial = useRef(status);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (status === 'delivered' || status === 'cancelled') return undefined;
    const url = `/api/order-status?number=${encodeURIComponent(orderNumber)}${token ? `&t=${encodeURIComponent(token)}` : ''}`;
    const id = setInterval(async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (d.status && d.status !== initial.current) {
          clearInterval(id);
          setUpdating(true);
          window.location.reload();
        }
      } catch { /* transient — keep polling */ }
    }, 30000);
    return () => clearInterval(id);
  }, [orderNumber, token, status]);

  if (!updating) return null;
  return <div className="hint" style={{ marginTop: 8 }}>Updating your order status…</div>;
}

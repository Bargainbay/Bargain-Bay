'use client';
import { useEffect } from 'react';
import { purchase, newEventId } from '../lib/fpixel';

function getCookie(name) {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.split('; ').find((r) => r.startsWith(name + '='))?.split('=')[1];
}

// Fires Purchase once per order (browser pixel + server CAPI, shared eventId so
// Meta dedupes). Guarded by localStorage so a refresh doesn't double-count.
export default function PixelPurchase({ orderNumber, ids = [], value, email }) {
  useEffect(() => {
    if (!orderNumber) return;
    const key = 'bb_purchase_' + orderNumber;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch {}
    const eventId = newEventId();
    purchase({ ids, value }, eventId);
    fetch('/api/meta-capi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'Purchase', eventId, eventSourceUrl: window.location.href,
        email, contentIds: ids, value, currency: 'CAD',
        fbp: getCookie('_fbp'), fbc: getCookie('_fbc'),
      }),
    }).catch(() => {});
  }, [orderNumber]);
  return null;
}

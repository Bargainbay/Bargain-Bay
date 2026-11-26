'use client';
import { useEffect } from 'react';
import { getCart, onCartChange } from '../lib/cart';
import { watchCheckoutFields } from '../lib/checkout-watch';

// Tells the server who is holding which cart, ONLY once they are identifiable:
// signed in (the server reads the session) or an email/phone in the boxes on
// /checkout, typed or autofilled — before they submit, because the ones we want
// to reach are the ones who never do (lib/checkout-watch). Renders nothing and
// can never block the page.
const TOKEN_KEY = 'bb_cart_token';

function token() {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^A-Za-z0-9_-]/g, '');
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch { return null; }
}

export default function CartCapture() {
  useEffect(() => {
    const tok = token();
    if (!tok) return undefined;
    let timer = null;
    let lastSent = '';
    let fields = { email: '', phone: '', name: '' };

    const send = () => {
      clearTimeout(timer);
      const skus = getCart();
      const body = JSON.stringify({ token: tok, skus, ...fields });
      if (body === lastSent) return;
      lastSent = body;
      fetch('/api/cart-capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(send, 1500); };

    const stop = watchCheckoutFields(document, window, (next, now) => {
      fields = next;
      if (now) send(); else soon();
    });
    const off = onCartChange(soon);
    soon();   // signed-in shoppers are identified server-side, so report once on load
    return () => { stop(); off(); clearTimeout(timer); };
  }, []);
  return null;
}

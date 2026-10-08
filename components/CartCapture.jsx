'use client';
import { useEffect } from 'react';
import { getCart, onCartChange } from '../lib/cart';

// Tells the server who is holding which cart, ONLY once they are identifiable:
// signed in (the server reads the session) or an email/phone typed on /checkout,
// captured on blur — before they submit, because the ones we want to reach are
// the ones who never do. Renders nothing and can never block the page.
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
    const ident = { email: '', phone: '', name: '' };

    const send = () => {
      const skus = getCart();
      const body = JSON.stringify({ token: tok, skus, ...ident });
      if (body === lastSent) return;
      lastSent = body;
      fetch('/api/cart-capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(send, 1500); };

    const onBlur = (e) => {
      const el = e.target;
      if (!el || !el.id) return;
      if (el.id === 'co-email') ident.email = el.value.trim();
      else if (el.id === 'co-phone') ident.phone = el.value.trim();
      else if (el.id === 'co-name') ident.name = el.value.trim();
      else return;
      soon();
    };
    document.addEventListener('focusout', onBlur);
    const off = onCartChange(soon);
    soon();   // signed-in shoppers are identified server-side, so report once on load
    return () => { document.removeEventListener('focusout', onBlur); off(); clearTimeout(timer); };
  }, []);
  return null;
}

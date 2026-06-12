'use client';
// Client-side cart: localStorage 'bb_cart' = array of SKUs.
// Every unit is one-of-a-kind, so the cart is a set — adding twice is a no-op.

const KEY = 'bb_cart';
const EVENT = 'bb_cart_change';

export function getCart() {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(skus) {
  localStorage.setItem(KEY, JSON.stringify(skus));
  window.dispatchEvent(new Event(EVENT));
}

export function addToCart(sku) {
  const cart = getCart();
  if (cart.includes(sku)) return cart;
  const next = [...cart, sku];
  save(next);
  return next;
}

export function removeFromCart(sku) {
  const next = getCart().filter((x) => x !== sku);
  save(next);
  return next;
}

export function clearCart() {
  save([]);
}

export function inCart(sku) {
  return getCart().includes(sku);
}

// Subscribe to cart changes (this tab + other tabs). Returns unsubscribe fn.
export function onCartChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => fn(getCart());
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

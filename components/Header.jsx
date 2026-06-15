'use client';
import { useEffect, useState } from 'react';
import { getCart, onCartChange } from '../lib/cart';
import { COLLECTIONS } from '../lib/constants';

export default function Header() {
  const [count, setCount] = useState(0);
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setCount(getCart().length);
    const unsub = onCartChange((cart) => setCount(cart.length));
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setUser(d.user || null))
      .catch(() => {});
    return unsub;
  }, []);

  return (
    <header className="site-header">
      <div className="announce">
        New lot just landed — tested &amp; working, <b>up to ~70% off retail</b>. <a href="/shop">Shop now →</a>
      </div>
      <div className="wrap">
        <div className="header-row">
          <a href="/" className="logo" aria-label="Bargain Bay home">
            <img src="/bargain-bay-logo-transparent.png" alt="Bargain Bay" />
            <span className="logo-sub">Liquidation appliances · Hamilton / GTA</span>
          </a>
          <nav className={'main-nav' + (open ? ' open' : '')} onClick={() => setOpen(false)}>
            <a href="/shop">Shop</a>
            <a href="/clearance" className="nav-clearance">Clearance</a>
            <a href="/track">Track Order</a>
            <a href="/contact">Contact</a>
            {user ? <a href="/account">My Account</a> : <a href="/login">Login</a>}
          </nav>
          <div className="header-actions">
            <a href={user ? '/account' : '/login'} className="btn" style={{ padding: '7px 12px' }}>
              {user ? (user.name ? user.name.split(' ')[0] : 'Account') : 'Login'}
            </a>
            <a href="/cart" className="cart-link" aria-label={`Cart, ${count} items`}>
              🛒{count > 0 && <span className="cart-count">{count}</span>}
            </a>
            <button className="menu-btn" aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
          </div>
        </div>
        <div className="cats-row">
          {COLLECTIONS.map((c) => (
            <a key={c.slug} href={`/shop?collection=${c.slug}`}>{c.label}</a>
          ))}
          <a href="/clearance" className="cats-clearance">Clearance</a>
        </div>
      </div>
    </header>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { getCart, removeFromCart, onCartChange } from '../../lib/cart';
import { money, round2, HST_RATE, DELIVERY_FEE } from '../../lib/constants';
import ConditionPill from '../../components/ConditionPill';

export default function CartClient({ catalog, member }) {
  const [skus, setSkus] = useState(null); // null = not hydrated yet
  const [gone, setGone] = useState([]); // SKUs that sold / got reserved since being added

  useEffect(() => {
    const current = getCart();
    setSkus(current);
    if (current.length) {
      fetch(`/api/availability?skus=${encodeURIComponent(current.join(','))}`)
        .then((r) => (r.ok ? r.json() : { unavailable: [] }))
        .then((d) => setGone(Array.isArray(d.unavailable) ? d.unavailable : []))
        .catch(() => {});
    }
    return onCartChange(setSkus);
  }, []);

  if (skus === null) return <p>Loading your cart…</p>;

  const items = skus.map((sku) => catalog.find((u) => u.id === sku)).filter(Boolean);
  const subtotal = round2(items.reduce((a, u) => a + Number(u.price), 0));
  const hst = round2(subtotal * HST_RATE);
  const total = round2(subtotal + hst);

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <h1 style={{ color: 'var(--charcoal)' }}>Your cart is empty</h1>
        <p style={{ color: 'var(--muted)' }}>Every unit is one-of-a-kind — grab it before someone else does.</p>
        <a href="/shop" className="btn accent">Browse inventory</a>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ color: 'var(--charcoal)' }}>Your cart</h1>
      {gone.some((g) => skus.includes(g)) && (
        <div className="error-box">
          Heads up — {gone.filter((g) => skus.includes(g)).length === 1 ? 'an item in your cart is' : 'some items in your cart are'} no
          longer available (sold or held by another checkout). Remove {gone.filter((g) => skus.includes(g)).length === 1 ? 'it' : 'them'} to continue.
        </div>
      )}
      <div className="checkout-layout">
        <div>
          {items.map((u) => (
            <div className="cart-line" key={u.id}>
              <a href={`/product/${encodeURIComponent(u.id)}`} className="thumb">
                <img src={u.image} alt={u.title} />
              </a>
              <div>
                <a href={`/product/${encodeURIComponent(u.id)}`} style={{ fontWeight: 600 }}>
                  {u.title || `${u.make} ${u.model}`}
                </a>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '2px 0 6px' }}>
                  {u.make} · {u.model} · qty 1 (one available)
                </div>
                <ConditionPill condition={u.condition} />
                {gone.includes(u.id) && <span className="pill sold" style={{ marginLeft: 6 }}>No longer available</span>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="price" style={{ fontSize: 16 }}>{money(u.price)}</div>
                <button className="btn danger" style={{ marginTop: 8, padding: '5px 10px', fontSize: 12.5 }} onClick={() => removeFromCart(u.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="summary-card">
          <div className="summary-row"><span>Subtotal ({items.length} item{items.length > 1 ? 's' : ''})</span><span>{money(subtotal)}</span></div>
          <div className="summary-row"><span>HST (13%)</span><span>{money(hst)}</span></div>
          <div className="summary-row"><span>Pickup / delivery</span><span>chosen at checkout</span></div>
          <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
          {member && <div className="hint" style={{ marginTop: 8, color: '#0B6B3A', fontWeight: 600 }}>✓ Member pricing applied</div>}
          <a href="/checkout" className="btn primary block" style={{ marginTop: 14 }}>Checkout</a>
          <div className="hint" style={{ marginTop: 10 }}>
            Free warehouse pickup, or flat {money(DELIVERY_FEE)} local delivery (added at checkout, plus HST).
          </div>
        </div>
      </div>
    </div>
  );
}

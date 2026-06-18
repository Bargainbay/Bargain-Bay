'use client';
import { useEffect, useState } from 'react';
import { getCart, removeFromCart, clearCart, onCartChange } from '../../lib/cart';
import { money, round2, HST_RATE, DELIVERY_FEE, PICKUP_ADDRESS, CARD_PAYMENTS_ENABLED, ETRANSFER_EMAIL } from '../../lib/constants';

export default function CheckoutClient({ catalog, session }) {
  const [skus, setSkus] = useState(null);
  const [form, setForm] = useState({
    name: session?.name || '',
    email: session?.email || '',
    phone: '',
    deliveryMethod: 'pickup',
    address: '', city: '', postal: '',
    paymentMethod: 'etransfer',
    password: ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSkus(getCart());
    return onCartChange(setSkus);
  }, []);

  if (skus === null) return <p>Loading checkout…</p>;

  const items = skus.map((sku) => catalog.find((u) => u.id === sku)).filter(Boolean);
  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <h1 style={{ color: 'var(--charcoal)' }}>Nothing to check out</h1>
        <a href="/shop" className="btn accent">Browse inventory</a>
      </div>
    );
  }

  const delivery = form.deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
  const subtotal = round2(items.reduce((a, u) => a + Number(u.price), 0));
  const hst = round2((subtotal + delivery) * HST_RATE);
  const total = round2(subtotal + delivery + hst);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus, ...form })
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && Array.isArray(data.unavailable)) {
          data.unavailable.forEach((sku) => removeFromCart(sku));
          setError(data.error || 'Some items just sold and were removed from your cart.');
        } else {
          setError(data.error || 'Checkout failed. Please try again.');
        }
        return;
      }
      clearCart();
      window.location.href = data.url || data.orderUrl;
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ color: 'var(--charcoal)' }}>Checkout</h1>
      <form onSubmit={submit}>
        <div className="checkout-layout">
          <div>
            <div className="panel">
              <h2>Contact info</h2>
              <div className="form-2col">
                <div className="field">
                  <label htmlFor="co-name">Full name</label>
                  <input id="co-name" required autoComplete="name" value={form.name} onChange={set('name')} />
                </div>
                <div className="field">
                  <label htmlFor="co-phone">Phone</label>
                  <input id="co-phone" type="tel" required autoComplete="tel" value={form.phone} onChange={set('phone')} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="co-email">Email</label>
                <input id="co-email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} disabled={!!session} />
                {session && <div className="hint">Logged in as {session.email}</div>}
              </div>
              {!session && (
                <div className="field" style={{ background: '#f4f7fc', borderRadius: 10, padding: '12px 14px' }}>
                  <label htmlFor="co-pass">Create an account to track your order <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                  <input id="co-pass" type="password" minLength={8} autoComplete="new-password" placeholder="Choose a password (8+ characters)" value={form.password} onChange={set('password')} />
                  <div className="hint">Leave blank to check out as a guest — we&apos;ll email you a tracking link either way.</div>
                </div>
              )}
            </div>

            <div className="panel">
              <h2>Pickup or delivery</h2>
              <label className={'radio-card' + (form.deliveryMethod === 'pickup' ? ' active' : '')}>
                <input type="radio" name="deliveryMethod" value="pickup" checked={form.deliveryMethod === 'pickup'} onChange={set('deliveryMethod')} />
                <span>
                  <b>Warehouse pickup — Free</b>
                  <span className="sub" style={{ display: 'block' }}>{PICKUP_ADDRESS}. By appointment — we&apos;ll email you to schedule.</span>
                </span>
              </label>
              <label className={'radio-card' + (form.deliveryMethod === 'delivery' ? ' active' : '')}>
                <input type="radio" name="deliveryMethod" value="delivery" checked={form.deliveryMethod === 'delivery'} onChange={set('deliveryMethod')} />
                <span>
                  <b>Local delivery — {money(DELIVERY_FEE)} flat</b>
                  <span className="sub" style={{ display: 'block' }}>Hamilton &amp; area (within ~50 km of Lynden). To your door / ground floor. Farther out? Email us for a freight quote.</span>
                </span>
              </label>
              {form.deliveryMethod === 'delivery' && (
                <div style={{ marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="co-addr">Street address</label>
                    <input id="co-addr" required autoComplete="street-address" value={form.address} onChange={set('address')} />
                  </div>
                  <div className="form-2col">
                    <div className="field">
                      <label htmlFor="co-city">City</label>
                      <input id="co-city" required autoComplete="address-level2" value={form.city} onChange={set('city')} />
                    </div>
                    <div className="field">
                      <label htmlFor="co-postal">Postal code</label>
                      <input id="co-postal" required autoComplete="postal-code" value={form.postal} onChange={set('postal')} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!CARD_PAYMENTS_ENABLED && (
              <div className="panel">
                <h2>How you&apos;ll pay</h2>
                <p className="hint" style={{ marginTop: 0 }}>
                  We&apos;re not taking card payments online right now. Place your order and pay by
                  e-transfer or in person — your unit is held for you either way.
                </p>
                <label className={'radio-card' + (form.paymentMethod === 'etransfer' ? ' active' : '')}>
                  <input type="radio" name="paymentMethod" value="etransfer" checked={form.paymentMethod === 'etransfer'} onChange={set('paymentMethod')} />
                  <span>
                    <b>Interac e-Transfer</b>
                    <span className="sub" style={{ display: 'block' }}>
                      Send to <b>{ETRANSFER_EMAIL}</b> (auto-deposit — no security question). Put your order number in the message.
                    </span>
                  </span>
                </label>
                <label className={'radio-card' + (form.paymentMethod === 'in_person' ? ' active' : '')}>
                  <input type="radio" name="paymentMethod" value="in_person" checked={form.paymentMethod === 'in_person'} onChange={set('paymentMethod')} />
                  <span>
                    <b>Pay {form.deliveryMethod === 'delivery' ? 'on delivery' : 'on pickup'}</b>
                    <span className="sub" style={{ display: 'block' }}>
                      Cash, debit, or credit card in person {form.deliveryMethod === 'delivery' ? 'when we deliver' : 'when you pick up'}.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="summary-card">
            <h2 style={{ marginTop: 0, fontSize: 17, color: 'var(--charcoal)' }}>Order summary</h2>
            {items.map((u) => (
              <div className="summary-row" key={u.id}>
                <span style={{ paddingRight: 10 }}>{u.make} {u.model}</span>
                <span>{money(u.price)}</span>
              </div>
            ))}
            <div className="summary-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}>
              <span>Subtotal</span><span>{money(subtotal)}</span>
            </div>
            <div className="summary-row"><span>{form.deliveryMethod === 'delivery' ? 'Local delivery' : 'Warehouse pickup'}</span><span>{delivery ? money(delivery) : 'Free'}</span></div>
            <div className="summary-row"><span>HST (13%)</span><span>{money(hst)}</span></div>
            <div className="summary-row total"><span>Total (CAD)</span><span>{money(total)}</span></div>
            {error && <div className="error-box">{error}</div>}
            <button className="btn accent block" style={{ marginTop: 14 }} disabled={busy}>
              {busy ? 'Placing order…' : 'Place order'}
            </button>
            <div className="hint" style={{ marginTop: 10 }}>
              {CARD_PAYMENTS_ENABLED
                ? 'Each unit is held for you for 30 minutes while you complete payment.'
                : form.paymentMethod === 'etransfer'
                  ? <>After you place the order, send your e-transfer to <b>{ETRANSFER_EMAIL}</b> with your order number. We hold your unit until it arrives.</>
                  : <>We&apos;ll hold your unit and email you to arrange {form.deliveryMethod === 'delivery' ? 'delivery' : 'pickup'} — pay in person then.</>}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

'use client';
import { useEffect, useState, useRef } from 'react';
import { getCart, removeFromCart, clearCart, onCartChange } from '../../lib/cart';
import { money, round2, HST_RATE, DELIVERY_FEE, PICKUP_ADDRESS, CARD_PAYMENTS_ENABLED, ETRANSFER_EMAIL } from '../../lib/constants';
import { shipmentCount, notPickable } from '../../lib/marketplace-rules';
import { loadGoogleMaps, placesReady, mapsKey } from '../../lib/maps';
import HoneypotField from '../../components/HoneypotField';
import MarketingOptIn, { CONSENT_TEXT } from '../../components/MarketingOptIn';
import { initiateCheckout, purchase, newEventId } from '../../lib/fpixel';

export default function CheckoutClient({ catalog, session, prefill }) {
  const [skus, setSkus] = useState(null);
  const [form, setForm] = useState({
    name: session?.name || prefill?.name || '',
    email: session?.email || '',
    phone: prefill?.phone || '',
    deliveryMethod: 'pickup',
    address: prefill?.address || '', city: prefill?.city || '', postal: prefill?.postal || '',
    paymentMethod: 'etransfer',
    password: '',
    // Honeypot — stays '' for every real customer and rides along in the POST
    // body via the {...form} spread in submit().
    website: '',
    marketingOptIn: false
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Promo code. `applied` is what the server said the code is worth; it is only
  // ever a preview — /api/checkout recomputes the discount from its own prices,
  // so a stale figure here can't turn into a stale figure on the order.
  const [promo, setPromo] = useState('');
  const [applied, setApplied] = useState(null);
  const [promoMsg, setPromoMsg] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const acDone = useRef(false);
  // An automatic promotion the cart qualifies for (no code typed). Only a
  // preview: /api/checkout works the real figure out again.
  const [auto, setAuto] = useState(null);

  useEffect(() => {
    setSkus(getCart());
    return onCartChange(setSkus);
  }, []);

  useEffect(() => {
    if (!skus || skus.length === 0) { setAuto(null); return undefined; }
    let live = true;
    fetch('/api/coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto: true, skus, email: form.email })
    })
      .then((r) => r.json())
      .then((d) => { if (live) setAuto(d && d.ok && d.auto ? { auto: true, code: d.code, discount: Number(d.discount) || 0, label: d.label, capped: !!d.capped } : null); })
      .catch(() => { if (live) setAuto(null); });
    return () => { live = false; };
  }, [skus, form.email]);

  // InitiateCheckout, once per visit, when there is something in the cart. The
  // helper in lib/fpixel.js existed and nothing called it, so Meta never saw a
  // checkout start — which is also why it could not optimise past Add to cart.
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current || !skus || skus.length === 0) return;
    const items = skus.map((sku) => catalog.find((u) => u.id === sku)).filter(Boolean);
    if (items.length === 0) return;
    checkoutTracked.current = true;
    initiateCheckout({
      ids: items.map((u) => u.id),
      value: round2(items.reduce((a, u) => a + Number(u.price), 0)),
      numItems: items.length
    }, newEventId());
  }, [skus, catalog]);

  // Google Places autocomplete on the delivery street address (same pattern as
  // the admin invoice form): attach on first focus, poll until Places is
  // actually ready. No-op without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
  async function attachAutocomplete(e) {
    if (acDone.current || !mapsKey()) return;
    const input = e.currentTarget;
    await loadGoogleMaps();
    const places = await placesReady();
    if (acDone.current || !places || !input) return;
    acDone.current = true;
    try {
      const ac = new places.Autocomplete(input, {
        componentRestrictions: { country: 'ca' },
        fields: ['address_components'],
        types: ['address']
      });
      ac.addListener('place_changed', () => {
        const comps = ac.getPlace()?.address_components || [];
        const get = (type, short) => comps.find((c) => c.types.includes(type))?.[short ? 'short_name' : 'long_name'] || '';
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
        const town = get('locality') || get('postal_town') || get('sublocality_level_1') || '';
        const code = get('postal_code', true);
        setForm((f) => ({ ...f, address: street || f.address, city: town || f.city, postal: code || f.postal }));
      });
    } catch { acDone.current = false; }
  }

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

  // A seller's unit that is not in our building (collected by our crew, or shipped by the seller)
  // cannot be picked up at the warehouse, so those carts are delivery-only. Each separate shipment
  // — everything WE move is one, and each self-shipping seller is another — carries its own fee.
  const mustDeliver = items.some(notPickable);
  const method = mustDeliver ? 'delivery' : form.deliveryMethod;
  const shipments = Math.max(1, shipmentCount(items));
  const delivery = method === 'delivery' ? round2(DELIVERY_FEE * shipments) : 0;
  const subtotal = round2(items.reduce((a, u) => a + Number(u.price), 0));
  // A typed code and an automatic promotion never stack; the shopper gets the
  // better one, exactly as the server will decide.
  const shown = applied && (!auto || applied.discount >= auto.discount) ? applied : auto;
  const discount = shown ? Math.min(shown.discount, subtotal) : 0;
  const hst = round2((subtotal - discount + delivery) * HST_RATE);
  const total = round2(subtotal - discount + delivery + hst);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function applyPromo() {
    const code = promo.trim();
    if (!code) { setPromoMsg('Enter a promo code.'); return; }
    setPromoBusy(true); setPromoMsg('');
    try {
      const res = await fetch('/api/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, skus, email: form.email })
      });
      const d = await res.json();
      if (!d.ok) { setApplied(null); setPromoMsg(d.error || 'That code isn’t valid.'); return; }
      setApplied({ code: d.code, discount: Number(d.discount) || 0, label: d.label });
      setPromoMsg('');
    } catch {
      setPromoMsg('Couldn’t check that code — please try again.');
    } finally {
      setPromoBusy(false);
    }
  }

  function clearPromo() {
    setApplied(null); setPromo(''); setPromoMsg('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skus, ...form, deliveryMethod: method,
          couponCode: applied ? applied.code : '',
          // The sentence they were actually shown travels with the tick. That
          // wording is what makes the consent record proof of anything.
          marketingOptInText: form.marketingOptIn ? CONSENT_TEXT : ''
        })
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
      // The server has the final say on the code. If it dropped it, the order
      // still stands — say so rather than sending them on believing otherwise.
      if (applied && data.couponError) {
        setApplied(null);
        setError(`${data.couponError} Your order was placed at full price — check the summary before you send payment.`);
      }
      // Card payments are off, so an order is placed with no payment step and
      // the order page's `status=success` Purchase never fires — Meta saw zero
      // purchases. Count the placed order here, ONLY when there is no card
      // redirect (a Stripe order is counted by the order page once it is paid,
      // and counting it here too would double it). Same localStorage key as
      // PixelPurchase so one order can never be counted by both.
      if (!data.url && data.orderNumber) {
        try {
          const key = 'bb_purchase_' + data.orderNumber;
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, '1');
            purchase({ ids: items.map((u) => u.id), value: total }, newEventId());
          }
        } catch {}
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
        <HoneypotField value={form.website} onChange={set('website')} />
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
              <MarketingOptIn
                id="co-marketing"
                checked={form.marketingOptIn}
                onChange={(v) => setForm((f) => ({ ...f, marketingOptIn: v }))}
              />
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
              <label className={'radio-card' + (method === 'pickup' ? ' active' : '')}>
                <input type="radio" name="deliveryMethod" value="pickup" disabled={mustDeliver} checked={method === 'pickup'} onChange={() => setForm((f) => ({ ...f, deliveryMethod: 'pickup' }))} />
                <span>
                  <b>Warehouse pickup — Free</b>
                  <span className="sub" style={{ display: 'block' }}>{mustDeliver
                    ? 'Not available for this cart — an item is with one of our marketplace sellers, so it has to be delivered.'
                    : <>{PICKUP_ADDRESS}. By appointment — we&apos;ll email you to schedule.</>}</span>
                </span>
              </label>
              <label className={'radio-card' + (method === 'delivery' ? ' active' : '')}>
                <input type="radio" name="deliveryMethod" value="delivery" checked={method === 'delivery'} onChange={() => setForm((f) => ({ ...f, deliveryMethod: 'delivery', paymentMethod: 'etransfer' }))} />
                <span>
                  <b>Local delivery — {shipments > 1 ? `${money(DELIVERY_FEE)} × ${shipments} shipments` : `${money(DELIVERY_FEE)} flat`}</b>
                  <span className="sub" style={{ display: 'block' }}>Pickering &amp; area (within ~50 km of Pickering). To your door / ground floor. Farther out? Email us for a freight quote.</span>
                </span>
              </label>
              {method === 'delivery' && (
                <div style={{ marginTop: 12 }}>
                  <div className="field">
                    <label htmlFor="co-addr">Street address</label>
                    <input id="co-addr" required autoComplete="off" onFocus={attachAutocomplete}
                      placeholder={mapsKey() ? 'Start typing your address…' : undefined}
                      value={form.address} onChange={set('address')} />
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
                  We&apos;re not taking card payments online right now. Place your order and pay by Interac e-transfer
                  {method === 'pickup' ? ' (or in person at pickup)' : ''} — we hold your unit for 24 hours
                  while we confirm payment.
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
                {method === 'pickup' && (
                  <label className={'radio-card' + (form.paymentMethod === 'in_person' ? ' active' : '')}>
                    <input type="radio" name="paymentMethod" value="in_person" checked={form.paymentMethod === 'in_person'} onChange={set('paymentMethod')} />
                    <span>
                      <b>Pay on pickup</b>
                      <span className="sub" style={{ display: 'block' }}>
                        Cash, debit, or credit card in person when you pick up.
                      </span>
                    </span>
                  </label>
                )}
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
            {discount > 0 && (
              <div className="summary-row">
                <span>{shown.auto ? 'Automatic discount' : `Promo ${shown.code}`}{shown.label ? ` (${shown.label})` : ''}</span><span>−{money(discount)}</span>
              </div>
            )}
            <div className="summary-row"><span>{method === 'delivery' ? 'Local delivery' : 'Warehouse pickup'}</span><span>{delivery ? money(delivery) : 'Free'}</span></div>
            <div style={{ margin: '10px 0 4px' }}>
              {applied ? (
                <div className="hint" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span><b>{applied.code}</b> applied — {applied.label}</span>
                  <button type="button" className="linkish" onClick={clearPromo}>Remove</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input aria-label="Promo code" placeholder="Promo code" value={promo}
                      onChange={(e) => setPromo(e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } }}
                      style={{ flex: 1, minWidth: 0, fontSize: 16, textTransform: 'uppercase' }} />
                    <button type="button" className="btn" disabled={promoBusy || !promo.trim()} onClick={applyPromo}>
                      {promoBusy ? '…' : 'Apply'}
                    </button>
                  </div>
                  {promoMsg && <div className="hint" style={{ color: 'var(--danger, #c0392b)', marginTop: 6 }}>{promoMsg}</div>}
                </>
              )}
            </div>
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
                  : <>We&apos;ll hold your unit and email you to arrange {method === 'delivery' ? 'delivery' : 'pickup'} — pay in person then.</>}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

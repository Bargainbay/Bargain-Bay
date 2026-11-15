'use client';
import { useState } from 'react';
import { money } from '../lib/constants';
import { addToCart } from '../lib/cart';

// The page behind an emailed offer link: confirm the email, see the answer, take a counter, or buy at the agreed price.
export default function OfferStatus({ offer, token }) {
  const [o, setO] = useState(offer);
  const [msg, setMsg] = useState('');
  async function act(action) {
    setMsg('');
    const r = await fetch('/api/offers/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: o.id, t: token, action }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || 'Could not do that.'); return; }
    if (action === 'claim') { addToCart(d.sku); window.location.href = '/cart'; return; }
    if (action === 'confirm') setO({ ...o, verified_at: new Date().toISOString() });
    if (action === 'withdraw') setO({ ...o, status: 'withdrawn' });
    if (action === 'accept_counter') setO({ ...o, status: 'accepted', expires_at: new Date(Date.now() + 4 * 3600e3).toISOString() });
  }
  const live = ['open', 'countered', 'accepted'].includes(o.status);
  return (
    <div className="panel">
      <b>{o.title}</b>
      <p style={{ margin: '6px 0' }}>You offered {money(Number(o.amount))} (listed at {money(Number(o.list_price))}).</p>
      {o.status === 'open' && !o.verified_at && <><p>Please confirm your email address so we can look at your offer.</p><button className="btn" onClick={() => act('confirm')}>Confirm my email</button></>}
      {o.status === 'open' && o.verified_at && <p>We have your offer and will answer by email, usually within a business day.</p>}
      {o.status === 'countered' && <><p>We can do <b>{money(Number(o.agreed_price))}</b>. Nothing is held until you take it.</p><button className="btn" onClick={() => act('accept_counter')}>Take {money(Number(o.agreed_price))}</button></>}
      {o.status === 'accepted' && <><p>Accepted at <b>{money(Number(o.agreed_price))}</b>. Held for you until {new Date(o.expires_at).toLocaleString('en-CA')}. Please pay right away: an order not paid within 12 hours of checkout is cancelled.</p><button className="btn" onClick={() => act('claim')}>Add to order &amp; check out</button></>}
      {['declined', 'expired', 'withdrawn', 'purchased'].includes(o.status) && <p>This offer is {o.status === 'purchased' ? 'complete. Thank you!' : o.status + '.'} <a href="/shop" style={{ textDecoration: 'underline' }}>Back to the shop</a></p>}
      {live && o.status !== 'accepted' && <p style={{ marginTop: 10 }}><button className="btn" onClick={() => act('withdraw')}>Withdraw my offer</button></p>}
      {msg && <div className="error-box" role="alert">{msg}</div>}
    </div>
  );
}

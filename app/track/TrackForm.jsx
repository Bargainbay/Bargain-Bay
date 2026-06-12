'use client';
import { useState } from 'react';

export default function TrackForm() {
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');

  function submit(e) {
    e.preventDefault();
    let num = orderNumber.trim().toUpperCase();
    if (num && !num.startsWith('BB-')) num = 'BB-' + num.replace(/^#/, '');
    window.location.href = `/order/${encodeURIComponent(num)}?email=${encodeURIComponent(email.trim())}`;
  }

  return (
    <div className="narrow">
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--navy)' }}>Track your order</h1>
        <p className="hint" style={{ marginBottom: 16 }}>
          Enter your order number (it looks like <b>BB-1042</b>, from your confirmation page or email)
          and the email you used at checkout.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="track-num">Order number</label>
            <input id="track-num" required placeholder="BB-1042" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="track-mail">Email used on the order</label>
            <input id="track-mail" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn primary block">View order status</button>
        </form>
        <p className="hint" style={{ marginTop: 14 }}>
          Have an account? <a href="/login?next=/account" style={{ fontWeight: 700, color: 'var(--navy)' }}>Log in</a> to see all your orders.
          Can&apos;t find your order number? Email <a href="mailto:sales@bargainbay.ca" style={{ textDecoration: 'underline' }}>sales@bargainbay.ca</a>.
        </p>
      </div>
    </div>
  );
}

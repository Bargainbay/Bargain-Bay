'use client';
import { useState } from 'react';

// The "Accept this quote" button on the hosted quote page. Accepting tells the
// owner to convert + invoice; nothing is reserved until they do.
export default function AcceptQuote({ number, token, email }) {
  const [state, setState] = useState('idle'); // idle | busy | done
  const [err, setErr] = useState('');

  async function accept() {
    setState('busy'); setErr('');
    try {
      const res = await fetch('/api/quote-accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, t: token || undefined, email: email || undefined })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not accept the quote.'); setState('idle'); return; }
      setState('done');
    } catch {
      setErr('Network error — please try again.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        <b>✓ Quote accepted — thank you!</b> We&apos;ve been notified and will email you the invoice with payment
        details shortly. Your units are locked in once the invoice is issued.
      </div>
    );
  }
  return (
    <div style={{ margin: '4px 0 14px' }}>
      {err && <div className="error-box">{err}</div>}
      <button className="btn accent" style={{ fontSize: 15, padding: '10px 22px' }} disabled={state === 'busy'} onClick={accept}>
        {state === 'busy' ? 'Accepting…' : 'Accept this quote ✓'}
      </button>
      <div className="hint" style={{ marginTop: 6 }}>
        Accepting doesn&apos;t charge you anything — it tells us you&apos;re ready, and we&apos;ll send the invoice to lock in your units.
      </div>
    </div>
  );
}

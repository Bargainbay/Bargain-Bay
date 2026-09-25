'use client';
import { useState } from 'react';

// One button. CASL wants the mechanism "readily performed", and every extra
// question between the person and stopping the email is a reason for them to
// press the spam button instead — which costs the sending domain far more than
// the unsubscribe does.
export default function UnsubscribeForm({ identity, token, channel }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const isSms = channel === 'sms';

  async function go(all) {
    setState('working'); setError('');
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, token, channel, all })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'That did not work.'); setState('idle'); return; }
      setState(all ? 'done-all' : 'done');
    } catch {
      setError('We could not reach the server. Please try again.');
      setState('idle');
    }
  }

  if (state === 'done' || state === 'done-all') {
    return (
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Done — you&apos;re unsubscribed.</h1>
        <p style={{ fontSize: 15 }}>
          {state === 'done-all'
            ? <>We&apos;ve stopped all marketing email and texts to <b>{identity}</b>.</>
            : <>We&apos;ve stopped marketing {isSms ? 'texts' : 'emails'} to <b>{identity}</b>.</>}
        </p>
        {/* Saying this up front prevents the "I unsubscribed and you emailed me
            anyway" complaint, which is about a receipt, not a campaign. */}
        <p className="hint">
          You&apos;ll still get messages about orders you place — confirmations, invoices and
          delivery updates. Those aren&apos;t marketing and we can&apos;t switch them off.
        </p>
        {state === 'done' && (
          <p style={{ fontSize: 14, marginBottom: 0 }}>
            <button className="btn" onClick={() => go(true)} disabled={state === 'working'}>
              Stop everything, email and text
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Unsubscribe</h1>
      <p style={{ fontSize: 15 }}>
        Stop sending marketing {isSms ? 'texts' : 'emails'} to <b>{identity}</b>?
      </p>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      <p>
        <button className="btn primary" onClick={() => go(false)} disabled={state === 'working'}>
          {state === 'working' ? 'Working…' : 'Yes, unsubscribe me'}
        </button>
      </p>
      <p className="hint" style={{ marginBottom: 0 }}>
        You&apos;ll still get messages about orders you place — confirmations, invoices and
        delivery updates.
      </p>
    </div>
  );
}

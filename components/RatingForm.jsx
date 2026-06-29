'use client';
import { useState } from 'react';

// Public post-delivery rating widget. Posts to /api/rate with the order link token.
export default function RatingForm({ orderNumber, token }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | done | error
  const [err, setErr] = useState('');

  async function submit() {
    if (!rating) { setErr('Please pick a star rating.'); return; }
    setState('saving'); setErr('');
    try {
      const res = await fetch('/api/rate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, token, rating, comment })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not submit.');
      setState('done');
    } catch (e) { setErr(e.message); setState('error'); }
  }

  if (state === 'done') {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Thank you! 🙏</h2>
        <p style={{ fontSize: 15 }}>Your {rating}-star rating was received. We appreciate you choosing Bargain Bay.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>How was your experience?</h2>
      <p className="hint" style={{ marginTop: 0 }}>Order {orderNumber}</p>
      <div style={{ display: 'flex', gap: 6, margin: '14px 0' }} role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setRating(n)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 38, lineHeight: 1, padding: 0, color: (hover || rating) >= n ? '#f5b301' : 'var(--line)' }}
          >★</button>
        ))}
      </div>
      <textarea
        value={comment} onChange={(e) => setComment(e.target.value)} rows={4}
        placeholder="Anything you'd like to tell us? (optional)"
        style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--line)', fontSize: 14, fontFamily: 'inherit' }}
      />
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn primary" style={{ marginTop: 12 }} disabled={state === 'saving'} onClick={submit}>
        {state === 'saving' ? 'Submitting…' : 'Submit rating'}
      </button>
    </div>
  );
}

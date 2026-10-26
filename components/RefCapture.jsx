'use client';
// Remembers an affiliate's link (?ref=CODE) for 30 days, in this browser only, so
// checkout can apply their code for a shopper who browses first and buys later.
// Nothing is sent anywhere here; the code is only ever checked server-side, at
// checkout, like any typed promo code. The most recent link wins.
import { useEffect } from 'react';

export default function RefCapture() {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('ref');
      if (code && /^[A-Za-z0-9._-]{2,24}$/.test(code)) {
        localStorage.setItem('bb_ref', JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
      }
    } catch { /* private window / blocked storage: no referral, nothing breaks */ }
  }, []);
  return null;
}

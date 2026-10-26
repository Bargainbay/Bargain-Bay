'use client';
// Remembers an affiliate's link (?ref=CODE) for 30 days, in this browser only, so
// checkout can apply their code for a shopper who browses first and buys later, and
// tells the server once a day that the link was opened (so the affiliate sees visits).
// The visitor id is a random string kept in this browser: not an IP, not a cookie shared
// with anything else. The code is only ever CHECKED server-side, like any typed promo code.
// The most recent link wins.
import { useEffect } from 'react';

const DAY = 86400000;

export default function RefCapture() {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('ref');
      if (!code || !/^[A-Za-z0-9._-]{2,24}$/.test(code)) return;
      const up = code.toUpperCase();
      localStorage.setItem('bb_ref', JSON.stringify({ code: up, at: Date.now() }));

      // Count the visit at most once a day per code per browser (the server also dedupes).
      const last = JSON.parse(localStorage.getItem('bb_ref_ping') || 'null');
      if (last && last.code === up && Date.now() - last.at < DAY) return;
      let visitor = localStorage.getItem('bb_vid');
      if (!visitor) {
        visitor = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^A-Za-z0-9_-]/g, '');
        localStorage.setItem('bb_vid', visitor);
      }
      localStorage.setItem('bb_ref_ping', JSON.stringify({ code: up, at: Date.now() }));
      fetch('/api/affiliate/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: up, visitor }), keepalive: true }).catch(() => {});
    } catch { /* private window / blocked storage: no referral, nothing breaks */ }
  }, []);
  return null;
}

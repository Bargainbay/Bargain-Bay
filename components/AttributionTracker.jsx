'use client';
import { useEffect } from 'react';

// Must match ATTR_COOKIE in lib/attribution.js. Kept inline so this client
// component doesn't import the server-only lib (which pulls in pg).
const ATTR_COOKIE = 'bb_attr';

// Captures first-touch attribution once per visitor: utm params + referrer →
// a 30-day first-party cookie. No PII; never overwrites an existing first touch.
export default function AttributionTracker() {
  useEffect(() => {
    try {
      if (document.cookie.split('; ').some((c) => c.startsWith(`${ATTR_COOKIE}=`))) return;
      const p = new URLSearchParams(window.location.search);
      const payload = {
        us: p.get('utm_source') || '',
        um: p.get('utm_medium') || '',
        uc: p.get('utm_campaign') || '',
        r: document.referrer || '',
        t: Date.now()
      };
      const val = encodeURIComponent(JSON.stringify(payload));
      document.cookie = `${ATTR_COOKIE}=${val}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    } catch { /* cookies blocked — fine, we just won't attribute */ }
  }, []);
  return null;
}

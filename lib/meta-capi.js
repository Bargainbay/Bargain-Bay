// The one sender for Meta's Conversions API. Email and phone are hashed here and
// never leave raw. Used by /api/meta-capi (browse events) and lib/meta-purchases
// (the Purchase, once an order is paid).
import { createHash } from 'node:crypto';
import { FB_PIXEL_ID } from './fpixel';
import { isProduction } from './environment';
import { phoneKey } from './constants';

const sha = (v) => createHash('sha256').update(v).digest('hex');

export const capiToken = () => process.env.META_CAPI_ACCESS_TOKEN || '';
export const capiPixel = () => FB_PIXEL_ID || process.env.NEXT_PUBLIC_FB_PIXEL_ID || '';
// Nothing leaves outside production, so a preview deploy cannot put test orders
// into the real dataset.
export const capiReady = () => Boolean(capiToken() && capiPixel() && isProduction());

export function capiUser({ ip, userAgent, fbp, fbc, email, phone } = {}) {
  const user = {
    client_ip_address: ip || undefined,
    client_user_agent: userAgent || undefined,
    fbp: fbp || undefined,
    fbc: fbc || undefined
  };
  const em = String(email || '').trim().toLowerCase();
  if (em.includes('@')) user.em = [sha(em)];
  const ph = String(phoneKey(phone) || '').replace(/\D/g, '');
  if (ph.length >= 10) user.ph = [sha(ph)];
  return user;
}

// Resolves { ok } or { ok: false, error }. Never throws.
export async function postMetaEvent(event) {
  try {
    const payload = { data: [event] };
    if (process.env.META_CAPI_TEST_CODE) payload.test_event_code = process.env.META_CAPI_TEST_CODE;
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${capiPixel()}/events?access_token=${encodeURIComponent(capiToken())}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) return { ok: true };
    return { ok: false, error: `Meta answered ${res.status}: ${(await res.text()).slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: e?.message || 'request failed' };
  }
}

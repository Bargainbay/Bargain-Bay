import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { recordCart } from '../../../lib/abandoned-carts';
import { grantConsent, withdrawConsent } from '../../../lib/consent';
import { CONSENT_TEXT } from '../../../lib/consent-text';
import { clientIp, isBlocked, honeypotTripped } from '../../../lib/antifraud';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The browser reporting its cart. Stores nothing unless the shopper is
// identifiable, and ALWAYS answers 200: it must never be able to disturb the
// page it rides on. A signed-in user is identified by the session, never by
// the body, so nobody can file a cart under another account.
export async function POST(req) {
  try {
    let body; try { body = await req.json(); } catch { body = {}; }
    if (honeypotTripped(body)) return NextResponse.json({ ok: true });
    const session = await getSession().catch(() => null);
    const email = session?.email || body.email;
    if (await isBlocked({ email, phone: body.phone, ip: clientIp(req) }).catch(() => false)) {
      return NextResponse.json({ ok: true });
    }
    await recordCart({
      token: body.token, skus: body.skus, email,
      phone: body.phone, name: session?.name || body.name,
      userId: session?.userId
    });
    // The unticked box beside the email field on /checkout. The WORDING is ours
    // (never taken from the request), stored as the evidence. Only an explicit
    // true grants; an explicit false (ticked, then unticked) withdraws.
    if (email && typeof body.marketingOptIn === 'boolean') {
      const ip = clientIp(req);
      if (body.marketingOptIn) {
        await grantConsent({ channel: 'email', email, source: 'checkout', ip,
          evidence: `${CONSENT_TEXT} (ticked on the checkout page beside the email field, before placing an order)` });
      } else {
        await withdrawConsent({ channel: 'email', email, source: 'checkout', ip, evidence: 'Unticked the marketing box on the checkout page' });
      }
    }
  } catch (e) {
    console.error('cart-capture failed (ignored):', e.message);
  }
  return NextResponse.json({ ok: true });
}

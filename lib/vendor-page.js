// Gate for a vendor portal PAGE. Returns { ctx } for a permitted vendor user, or { view } —
// something to render instead — or redirects (to sign in, to type the second-factor code, to
// set it up). The vendor id always comes from the session (lib/vendor-session.js), and the
// permission is the same `can()` the API routes use: a page names the action it shows.
import { redirect } from 'next/navigation';
import { getSession } from './auth';
import { hasDb } from './db';
import { checkVendor, requireVendorIdentity, mfaContext } from './vendor-session';

const enc = encodeURIComponent;

export async function vendorGate(next = '/vendor', action) {
  const session = await getSession();
  if (!session) redirect(`/login?next=${enc(next)}`);
  if (!hasDb()) return { view: 'nodb' };
  const r = await checkVendor(action); // no action = refused, on purpose
  if (r.ok) return { ctx: r.ctx };
  if (r.reason === 'mfa_verify') redirect(`/vendor/mfa?next=${enc(next)}`);
  if (r.reason === 'mfa_enrol') redirect(`/vendor/security?next=${enc(next)}`);
  if (r.reason === 'forbidden') return { view: 'forbidden', email: session.email };
  if (r.reason === 'mfa_error') return { view: 'error' };
  return { view: 'denied', email: session.email };
}

/**
 * For the pages where someone sets up or types their second factor: signed in and acting for a
 * vendor, but NOT yet required to have passed it (they are here to). Nothing else may use this.
 */
export async function vendorIdentityGate(next = '/vendor/security') {
  const session = await getSession();
  if (!session) redirect(`/login?next=${enc(next)}`);
  if (!hasDb()) return { view: 'nodb' };
  const id = await requireVendorIdentity();
  if (!id) return { view: 'denied', email: session.email };
  try {
    return { ctx: { ...id, mfa: await mfaContext(id.session, id.vendor) } };
  } catch {
    return { view: 'error' };
  }
}

export const cents = (n) => `${n < 0 ? '−' : ''}$${(Math.abs(n) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

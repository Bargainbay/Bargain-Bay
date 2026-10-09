// Gate for a vendor portal PAGE. Returns { ctx } for a vendor user, or { view } — something to
// render instead. The vendor id always comes from the session (lib/vendor-session.js).
import { redirect } from 'next/navigation';
import { getSession } from './auth';
import { hasDb } from './db';
import { requireVendor } from './vendor-session';

export async function vendorGate(next = '/vendor') {
  const session = await getSession();
  if (!session) redirect(`/login?next=${next}`);
  if (!hasDb()) return { view: 'nodb' };
  const ctx = await requireVendor();
  if (!ctx) return { view: 'denied', email: session.email };
  return { ctx };
}

export const cents = (n) => `${n < 0 ? '−' : ''}$${(Math.abs(n) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

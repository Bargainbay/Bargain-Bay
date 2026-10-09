import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

// Who is signed in, and which portals they can reach — so the storefront header can offer a
// button back to wherever they work instead of making them type a URL. This is the caller's OWN
// information only; the pages behind those buttons still check access themselves.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null, portals: {} });
  const portals = { admin: isAdmin(session), staff: isStaff(session), vendor: false };
  if (hasDb()) {
    try {
      const { vendorAccess } = await import('../../../../lib/vendors');
      portals.vendor = !!(await vendorAccess(session.email));
    } catch { /* the tables may not exist yet; no vendor button is the right answer */ }
  }
  return NextResponse.json({ user: session, portals });
}

// A rep's own gross profit today and commission on it. Staff — a rep sees ONLY
// their own sales (the viewer is taken from the session, never a parameter); the
// team table is admin-only and is not even computed for anyone else.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { repProfit } from '../../../../lib/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!(s && isStaff(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const data = await repProfit({ name: s.name, email: s.email }, { all: isAdmin(s) });
    if (!data) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 400 });
  }
}

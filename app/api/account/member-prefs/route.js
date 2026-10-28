import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { isApprovedMember } from '../../../../lib/pricing';
import { saveWatch } from '../../../../lib/member-prefs';

export const dynamic = 'force-dynamic';

// An approved member saves their own watchlist. The member is the SESSION's, never a body field.
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Please log in first.' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  if (!(await isApprovedMember(session))) return NextResponse.json({ error: 'Members only.' }, { status: 403 });
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    return NextResponse.json({ ok: true, watch: await saveWatch(session.userId, body.watch) });
  } catch (e) {
    return NextResponse.json({ error: 'Could not save your watchlist. Try again.' }, { status: 500 });
  }
}

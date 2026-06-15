import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { requestMembership } from '../../../../lib/members';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Please log in first.' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const businessName = String(body.businessName || '').trim();
  if (!businessName) return NextResponse.json({ error: 'Business name is required.' }, { status: 400 });
  try {
    await requestMembership(session.userId, businessName, String(body.note || '').trim());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

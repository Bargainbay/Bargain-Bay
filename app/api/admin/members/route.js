import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listMembers, setMembership } from '../../../../lib/members';

export const dynamic = 'force-dynamic';
async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  try { return NextResponse.json({ members: await listMembers() }); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const userId = Number(body.userId); const decision = String(body.decision || '');
  if (!userId || !['approve', 'reject', 'revoke'].includes(decision))
    return NextResponse.json({ error: 'userId and a valid decision are required' }, { status: 400 });
  try { await setMembership(userId, decision); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

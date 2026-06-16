import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { listMembers, setMembership } from '../../../../lib/members';
import { sendMemberApproved } from '../../../../lib/email';

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
  try {
    await setMembership(userId, decision);
    // On approval, email the reseller that wholesale pricing is now live
    // (fire-and-forget — never block or fail the admin action on email).
    if (decision === 'approve') {
      try {
        const { rows } = await query('SELECT email, name, business_name FROM users WHERE id = $1', [userId]);
        const u = rows[0];
        if (u?.email) sendMemberApproved({ to: u.email, name: u.name, businessName: u.business_name }).catch(() => {});
      } catch (e) { console.error('member approval email failed', e.message); }
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

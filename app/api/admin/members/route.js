import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { listMembers, setMembership, pendingMemberCount, listUnappliedAccounts, addAsReseller } from '../../../../lib/members';
import { sendMemberApproved } from '../../../../lib/email';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  // ?count=1 is the nav badge: just the number waiting, not the whole list with order stats.
  const sp = new URL(req.url).searchParams;
  // ?unapplied=1&q= is the "make an existing account a reseller" picker.
  if (sp.get('unapplied')) {
    try { return NextResponse.json({ accounts: await listUnappliedAccounts({ q: sp.get('q') || '' }) }); }
    catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
  }
  if (sp.get('count')) return NextResponse.json({ pending: await pendingMemberCount() });
  try { return NextResponse.json({ members: await listMembers() }); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

export async function POST(req) {
  const session = await getSession();
  if (!(session && isAdmin(session))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const userId = Number(body.userId); const decision = String(body.decision || '');
  if (decision === 'add') {
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    try {
      const u = await addAsReseller(userId, body.businessName, { by: session.email });
      if (!u) return NextResponse.json({ error: 'That account cannot be added (already a reseller, or a driver account).' }, { status: 409 });
      await audit(session, { action: 'member.add', entity: 'user', entityId: u.id, summary: `Made ${u.email} a reseller (${u.business_name}) without an application` });
      // Awaited: the instance is frozen once the response is out. A mail problem never undoes the approval.
      try { await sendMemberApproved({ to: u.email, name: u.name, businessName: u.business_name }); }
      catch (e) { console.error('member add email failed', e.message); }
      return NextResponse.json({ ok: true, account: u });
    } catch (e) { return NextResponse.json({ error: e.message }, { status: /required/.test(e.message) ? 400 : 500 }); }
  }
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

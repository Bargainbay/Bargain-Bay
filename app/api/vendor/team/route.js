// A vendor's own team: the owner lists, invites, changes a role, removes. The vendor id comes
// from the session. Every change needs a fresh second factor (an invite is how a stolen owner
// session would hand itself a permanent seat), so the owner must have enrolled first.
import { NextResponse } from 'next/server';
import { requireVendor, checkVendor, denial } from '../../../../lib/vendor-session';
import { listTeam, inviteTeamMember, changeTeamRole, removeTeamMember } from '../../../../lib/vendor-team';
import { VENDOR_ROLES } from '../../../../lib/vendor-permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ctx = await requireVendor('team.view');
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({ team: await listTeam(ctx.vendor.id), roles: VENDOR_ROLES });
}

export async function POST(req) {
  const r = await checkVendor('team.manage', { stepUp: true });
  if (!r.ok) { const d = denial(r); return NextResponse.json(d.body, { status: d.status }); }
  const { vendor, session } = r.ctx;
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const by = session.email;
  try {
    switch (b?.action) {
      case 'invite': return NextResponse.json(await inviteTeamMember(vendor.id, { email: b.email, name: b.name, role: b.role, by }));
      case 'role': return NextResponse.json(await changeTeamRole(vendor.id, b.email, b.role, { by }));
      case 'remove': return NextResponse.json(await removeTeamMember(vendor.id, b.email, { by }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}

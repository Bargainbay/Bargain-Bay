// A partner's team: any ADMIN login of the organisation can add or remove a login. getPartner() is admin-only, so a lead
// generator (role 'affiliate') is refused here with 403 and can never add anybody. The partner is read from the
// SESSION, never the request, so nobody can touch another organisation's team.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { getPartner, addTeamMember, removeTeamMember, PartnerError } from '../../../../lib/referral-partners';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const partner = await getPartner(s.email);
  if (!partner) return NextResponse.json({ error: 'Not a referral partner.' }, { status: 403 });
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    if (b.action === 'add') return NextResponse.json(await addTeamMember(partner.email, { email: b.email, name: b.name, role: b.role }, s.email));
    if (b.action === 'remove') {
      if (String(b.email || '').toLowerCase().trim() === s.email.toLowerCase()) return NextResponse.json({ error: 'You cannot remove your own login.' }, { status: 400 });
      return NextResponse.json(await removeTeamMember(partner.email, b.email, s.email));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: e instanceof PartnerError ? 400 : 500 }); }
}

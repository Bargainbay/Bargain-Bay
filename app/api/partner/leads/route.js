// A partner's lead generators send leads here and read what happened to them. The seat (organisation + role) is read from the
// SESSION only; nothing in the request names an organisation or a member, so nobody can read or send as anybody else.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { getPartnerSeat } from '../../../../lib/referral-partners';
import { myLeads, submitLead, markNoticesSeen, orgOverview } from '../../../../lib/partner-leads';
import { LeadError } from '../../../../lib/leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function seatOf() {
  const s = await getSession();
  if (!s) return { res: NextResponse.json({ error: 'Please sign in.' }, { status: 401 }) };
  const seat = await getPartnerSeat(s.email);
  if (!seat) return { res: NextResponse.json({ error: 'Not a partner login.' }, { status: 403 }) };
  return { seat };
}
const fail = (e) => NextResponse.json({ error: e.message, code: e.code }, { status: e instanceof LeadError ? (e.code === 'rate' ? 429 : 400) : 500 });

export async function GET(req) {
  const { seat, res } = await seatOf();
  if (res) return res;
  try {
    const out = await myLeads(seat);
    if (seat.role === 'admin' && new URL(req.url).searchParams.get('overview') === '1') out.overview = await orgOverview(seat);
    return NextResponse.json(out);
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const { seat, res } = await seatOf();
  if (res) return res;
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    if (b.action === 'seen') return NextResponse.json(await markNoticesSeen(seat));
    if (b.action === 'submit') {
      const r = await submitLead(seat, b);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) { return fail(e); }
}

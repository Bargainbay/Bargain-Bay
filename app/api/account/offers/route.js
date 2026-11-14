import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { isApprovedMember } from '../../../../lib/pricing';
import { submitOffer, myOffers, withdrawOffer, acceptCounter, OfferError } from '../../../../lib/member-offers';

export const dynamic = 'force-dynamic';

// An approved reseller's own offers. The member is ALWAYS the session's, never a body field.
async function gate() {
  const session = await getSession();
  if (!session) return { res: NextResponse.json({ error: 'Please log in first.' }, { status: 401 }) };
  if (!hasDb()) return { res: NextResponse.json({ error: 'Database not configured' }, { status: 503 }) };
  if (!(await isApprovedMember(session))) return { res: NextResponse.json({ error: 'Resellers only.' }, { status: 403 }) };
  return { session };
}
const fail = (e) => e instanceof OfferError
  ? NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'nodb' ? 503 : 400 })
  : NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });

export async function GET() {
  const g = await gate(); if (g.res) return g.res;
  return NextResponse.json({ offers: await myOffers(g.session.userId) });
}

export async function POST(req) {
  const g = await gate(); if (g.res) return g.res;
  let b; try { b = await req.json(); } catch { b = {}; }
  try { return NextResponse.json(await submitOffer(g.session, { sku: b.sku, amount: b.amount, note: b.note })); } catch (e) { return fail(e); }
}

export async function PATCH(req) {
  const g = await gate(); if (g.res) return g.res;
  let b; try { b = await req.json(); } catch { b = {}; }
  const id = Number(b.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Which offer?' }, { status: 400 });
  try {
    if (b.action === 'withdraw') return NextResponse.json(await withdrawOffer(g.session.userId, id));
    if (b.action === 'accept_counter') return NextResponse.json(await acceptCounter(g.session, id));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return fail(e); }
}

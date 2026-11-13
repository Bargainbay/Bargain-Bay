// The posting kit: what is for sale (with each generator's own caption), what they posted, and what to take down. The seat comes from
// the SESSION only. Public prices only; nothing here ever returns a cost, a member price or another login's posts.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { getPartnerSeat } from '../../../../lib/referral-partners';
import { postingView, setPosted, PostingError } from '../../../../lib/partner-posting';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function seatOf() {
  const s = await getSession();
  if (!s) return { res: NextResponse.json({ error: 'Please sign in.' }, { status: 401 }) };
  const seat = await getPartnerSeat(s.email);
  if (!seat) return { res: NextResponse.json({ error: 'Not a partner login.' }, { status: 403 }) };
  return { seat };
}

export async function GET() {
  const { seat, res } = await seatOf();
  if (res) return res;
  try { return NextResponse.json(await postingView(seat)); }
  catch (e) { return NextResponse.json({ error: 'The posting kit could not be loaded. Please try again.' }, { status: 500 }); }
}

export async function POST(req) {
  const { seat, res } = await seatOf();
  if (res) return res;
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try { return NextResponse.json(await setPosted(seat, b.sku, b.action)); }
  catch (e) { return NextResponse.json({ error: e instanceof PostingError ? e.message : 'Something went wrong.', code: e.code }, { status: e instanceof PostingError ? 400 : 500 }); }
}

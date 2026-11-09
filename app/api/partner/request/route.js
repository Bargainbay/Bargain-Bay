// A partner asks us to quote or order for one of THEIR clients. The partner comes from the session only.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { requestForClient, PartnerError } from '../../../../lib/referral-partners';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try { return NextResponse.json(await requestForClient(s.email, b.customerId, b.note)); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: e instanceof PartnerError ? (e.code === 'nopartner' ? 403 : 400) : 500 }); }
}

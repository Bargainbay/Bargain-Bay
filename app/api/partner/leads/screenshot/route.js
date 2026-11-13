// A lead generator uploads a screenshot of a customer's details; the reply is the details read out of it, for them to check.
// The seat (organisation + login) comes from the SESSION only. One picture per request, already shrunk on the phone.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/auth';
import { getPartnerSeat } from '../../../../../lib/referral-partners';
import { storeAndRead } from '../../../../../lib/lead-screenshot';
import { LeadError } from '../../../../../lib/leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const seat = await getPartnerSeat(s.email);
  if (!seat) return NextResponse.json({ error: 'Not a partner login.' }, { status: 403 });
  let file;
  try { file = (await req.formData()).get('file'); } catch { return NextResponse.json({ error: 'That picture could not be sent. Please try again.' }, { status: 400 }); }
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No picture was sent.' }, { status: 400 });
  try {
    return NextResponse.json(await storeAndRead(seat, Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    const status = e instanceof LeadError ? (e.code === 'rate' ? 429 : e.code === 'toobig' ? 413 : 400) : 500;
    return NextResponse.json({ error: e instanceof LeadError ? e.message : 'Something went wrong. Please fill in the form by hand.' }, { status });
  }
}

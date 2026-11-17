// The Manager answering the phone: the owner (or Ravi) ringing in at any time.
//
// Point a Twilio number's "A call comes in" webhook (HTTP POST) at
//   https://bargainbay.ca/api/manager/inbound            (General Manager)
//   https://bargainbay.ca/api/manager/inbound?dept=delivery   (Delivery Manager)
//   https://bargainbay.ca/api/manager/inbound?dept=sales      (Sales Manager)
// One number is enough — the caller can say "put me through to delivery" and the
// Manager changes hats. Separate numbers per department are optional.
//
// TWO LOCKS, neither optional (same as the outbound call route):
//   1. Twilio's signature proves the request really came from Twilio;
//   2. the caller ID must be on the allow-list in lib/manager-policy.js (the owner
//      and Ravi). Anybody else hears "private line" and is hung up on — before a
//      database row is written or a word of business is said.
// Caller ID can in theory be spoofed by someone who can place calls AS the owner's
// number; that is why every money action still needs a read-back and a yes on a
// later turn, and why refunds, discounts and voids exist only on his instruction.
import { NextResponse } from 'next/server';
import { startInboundCall, greeting, callToken, twilioSignatureOk, sayTwiml, callBaseUrl } from '../../../../lib/manager-call';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const twiml = (xml) => new NextResponse(xml, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } });

export async function POST(req) {
  const url = new URL(req.url);
  let params = {};
  try { for (const [k, v] of (await req.formData()).entries()) params[k] = String(v); } catch { params = {}; }

  const signedUrl = `${callBaseUrl()}${url.pathname}${url.search}`;
  if (!twilioSignatureOk(signedUrl, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  if (!hasDb()) return twiml(await sayTwiml('The system is offline. Please try again shortly.', { hangUp: true }));

  try {
    const dept = url.searchParams.get('dept') || 'gm';
    const call = await startInboundCall({ from: params.From, callSid: params.CallSid, dept });
    if (!call) return twiml(await sayTwiml('This is a private line. Goodbye.', { hangUp: true }));
    const gatherTo = `${callBaseUrl()}/api/manager/call?callId=${call.id}&t=${callToken(call.id)}`;
    return twiml(await sayTwiml(await greeting(call.id), { gatherTo }));
  } catch (e) {
    console.error('manager inbound failed', e?.message || e);
    return twiml(await sayTwiml('Something went wrong at my end. Please try again.', { hangUp: true }));
  }
}

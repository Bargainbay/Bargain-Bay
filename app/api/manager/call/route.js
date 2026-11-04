// The Voice Manager's phone call, as Twilio sees it.
//
// One URL for the whole conversation: Twilio POSTs here to start, and again after
// every thing the owner says. Each hit returns TwiML that speaks a reply and opens
// the next `<Gather>`; the loop is Twilio's, so nothing holds a socket open.
//
// **Unauthenticated by session and locked by TWO checks, neither optional.** It
// can change the catalogue and refresh stock. Twilio's signature proves the
// request came from Twilio; the token in the URL proves it is about a call we
// actually placed. Same locks, same helpers, as /api/dispatch/import-call.
import { NextResponse } from 'next/server';
import {
  managerTurn, greeting, getCall, callTokenOk, twilioSignatureOk, sayTwiml, callBaseUrl,
  markAnswered, markEnded
} from '../../../../lib/manager-call';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const twiml = (xml) => new NextResponse(xml, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } });

export async function POST(req) {
  if (!hasDb()) return twiml(await sayTwiml('The system is offline. Nothing was changed.', { hangUp: true }));

  const url = new URL(req.url);
  const callId = url.searchParams.get('callId');
  const token = url.searchParams.get('t');
  const silent = url.searchParams.get('silent') === '1';
  if (!callId || !callTokenOk(callId, token)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  let params = {};
  try { for (const [k, v] of (await req.formData()).entries()) params[k] = String(v); } catch { params = {}; }

  // Signed against the URL we handed Twilio, built from our own config — not from
  // the incoming request, whose host and protocol have been through a proxy.
  const signedUrl = `${callBaseUrl()}${url.pathname}${url.search}`;
  if (!twilioSignatureOk(signedUrl, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const gatherTo = `${callBaseUrl()}${url.pathname}?callId=${callId}&t=${token}`;

  try {
    const call = await getCall(callId);
    if (!call) return twiml(await sayTwiml('This call is no longer on record. Goodbye.', { hangUp: true }));

    // A voicemail is not a briefing: say nothing and go. The list is on the page.
    if (params.AnsweredBy && params.AnsweredBy.startsWith('machine')) {
      await markEnded(callId, 'voicemail');
      return twiml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }
    await markAnswered(callId);

    if (silent) {
      // Ask once, then leave it — a call that reprompts an empty room is worse
      // than one that hangs up, and nothing is lost: it is all on the page.
      if (url.searchParams.get('again') === '1') {
        await markEnded(callId, 'done');
        return twiml(await sayTwiml('I could not hear you. Everything is on the Manager page. Goodbye.', { hangUp: true }));
      }
      return twiml(await sayTwiml('Sorry, I did not catch that. Are you there?', { gatherTo: `${gatherTo}&again=1` }));
    }

    if (!params.SpeechResult) {
      return twiml(await sayTwiml(await greeting(callId), { gatherTo }));
    }

    const { say, done } = await managerTurn(callId, params.SpeechResult);
    if (done) await markEnded(callId, 'done');
    return twiml(await sayTwiml(say, { gatherTo, hangUp: done }));
  } catch (e) {
    console.error('manager call turn failed', e?.message || e);
    return twiml(await sayTwiml('Something went wrong at my end. Nothing was changed. Goodbye.', { hangUp: true }));
  }
}

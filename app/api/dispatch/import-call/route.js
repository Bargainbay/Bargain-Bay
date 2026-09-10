// The phone call, as Twilio sees it.
//
// One URL for the whole conversation: Twilio POSTs here to start the call, and
// again after every thing the owner says. Each hit returns TwiML that speaks a
// reply and opens the next `<Gather>`, so the loop is Twilio's to run and there
// is no socket to keep alive inside a serverless function.
//
// **This route is unauthenticated by session and must stay locked by both of
// its own checks.** It can change a staged batch and, on a clear yes, put stops
// on the board. Twilio's signature proves the request came from Twilio; the
// token in the URL proves it is about a batch we actually rang out on. Neither
// alone is enough and neither may be skipped for convenience.
import { NextResponse } from 'next/server';
import {
  importCallTurn, openingLine, sayTwiml, batchTokenOk, twilioSignatureOk, callBaseUrl
} from '../../../../lib/import-call';
import { resolveBatch, openQuestions } from '../../../../lib/import-batches';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const twiml = (xml) => new NextResponse(xml, {
  status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }
});

export async function POST(req) {
  if (!hasDb()) return twiml(await sayTwiml('The office system is offline. Nothing was changed.', { hangUp: true }));

  const url = new URL(req.url);
  const batchId = url.searchParams.get('batchId');
  const token = url.searchParams.get('t');
  const silent = url.searchParams.get('silent') === '1';

  if (!batchId || !batchTokenOk(batchId, token)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  let params = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch { params = {}; }

  // Signed against the URL we handed Twilio, built from our own config — not
  // from the incoming request, whose host and protocol have been through a
  // proxy by the time they get here.
  const signedUrl = `${callBaseUrl()}${url.pathname}${url.search}`;
  if (!twilioSignatureOk(signedUrl, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const gatherTo = `${callBaseUrl()}${url.pathname}?batchId=${batchId}&t=${token}`;
  const by = { email: 'dispatch-call@rssolutions.ca', name: 'Owner (by phone)' };

  try {
    const batch = await resolveBatch(batchId);
    if (!batch) return twiml(await sayTwiml('That sheet is no longer here. Nothing was changed.', { hangUp: true }));
    if (batch.status !== 'draft') {
      return twiml(await sayTwiml(`That sheet was already ${batch.status}. Nothing was changed.`, { hangUp: true }));
    }

    // A voicemail is not a review. Twilio tells us when it thinks it reached a
    // machine; the batch keeps sitting on the Import tab either way, so the
    // right thing is to say nothing and go.
    if (params.AnsweredBy && params.AnsweredBy.startsWith('machine')) {
      return twiml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }

    // Three shapes of request, told apart by the URL rather than by guessing at
    // Twilio's call-status strings:
    //   no SpeechResult, no ?silent  → the first hit: the greeting
    //   ?silent=1                    → the Gather fell through, nobody spoke
    //   SpeechResult                 → he said something
    if (silent) {
      // Ask once, then leave it. A call that keeps reprompting into an empty
      // room is worse than one that hangs up, and nothing has been lost — the
      // batch is still sitting on the Import tab.
      if (url.searchParams.get('again') === '1') {
        return twiml(await sayTwiml(
          'I could not hear you. The sheet is still waiting to be checked on the Import tab. Goodbye.',
          { hangUp: true }
        ));
      }
      return twiml(await sayTwiml('Sorry, I did not catch that. Are you there?', { gatherTo: `${gatherTo}&again=1` }));
    }

    if (!params.SpeechResult) {
      // The summary is arithmetic off the batch, not something the model reads
      // back — there is no reason to give it a chance to get a count wrong.
      const line = `Hello, it's the dispatch office. ${openingLine(batch, openQuestions(batch))}`;
      return twiml(await sayTwiml(line, { gatherTo }));
    }

    const { say, done } = await importCallTurn(batchId, params.SpeechResult, by);
    return twiml(await sayTwiml(say, { gatherTo, hangUp: done }));
  } catch (e) {
    console.error('import call turn failed', e?.message || e);
    return twiml(await sayTwiml(
      'Something went wrong at this end. The sheet is untouched and still waiting on the Import tab. Goodbye.',
      { hangUp: true }
    ));
  }
}

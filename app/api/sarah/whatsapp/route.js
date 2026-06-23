// Sarah on WhatsApp (via Twilio). Inbound webhook: the owner texts or sends a
// voice note → we verify it's really Twilio, confirm the sender is the owner,
// transcribe any voice note, run Sarah, and reply with text + a spoken voice note.
//
// Dormant until the owner sets the env vars (TWILIO_*, ELEVENLABS_API_KEY,
// SARAH_ALLOWED_NUMBERS) — see the PR for the setup checklist.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { put } from '@vercel/blob';
import { runSarah } from '../../../../lib/sarah';
import { isAllowedSender, alreadyProcessed, loadThread, appendMessage, normalizePhone } from '../../../../lib/sarah-threads';
import { voiceConfigured, transcribeAudio, synthesizeSpeech } from '../../../../lib/voice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

// Twilio signs every webhook: HMAC-SHA1 over (exact URL + sorted POST params),
// keyed by the auth token. This proves the request came from Twilio and stops a
// spoofed "From" from impersonating the owner.
function twilioValid(url, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

function webhookUrl(req) {
  if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}/api/sarah/whatsapp`;
}

async function fetchTwilioMedia(url) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!resp.ok) throw new Error(`media fetch ${resp.status}`);
  return { buf: Buffer.from(await resp.arrayBuffer()), mime: resp.headers.get('content-type') || 'audio/ogg' };
}

async function sendWhatsApp({ to, from, body, mediaUrl }) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams();
  form.set('To', to); form.set('From', from);
  if (body) form.set('Body', String(body).slice(0, 1500));
  if (mediaUrl) form.append('MediaUrl', mediaUrl);
  const resp = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  if (!resp.ok) console.error('twilio send', resp.status, await resp.text().catch(() => ''));
}

export async function POST(req) {
  // Twilio posts application/x-www-form-urlencoded.
  const params = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : '';
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  if (!twilioValid(webhookUrl(req), params, req.headers.get('x-twilio-signature'))) {
    console.warn('sarah whatsapp: bad Twilio signature');
    return new NextResponse('forbidden', { status: 403 });
  }

  const from = params.From || '';   // whatsapp:+1...  (the owner)
  const to = params.To || '';       // whatsapp:+1...  (Sarah's number)
  const sender = normalizePhone(from);
  const msgSid = params.MessageSid || params.SmsMessageSid || '';

  // Only the owner may operate Sarah. Silently ignore anyone else (no reply,
  // no cost). Note: replies go To=`from`, From=`to` (swap perspective).
  if (!isAllowedSender(sender)) {
    console.warn('sarah whatsapp: sender not allowlisted', sender);
    return new NextResponse('', { status: 200 });
  }

  // Twilio may retry; don't double-act on the same inbound message.
  if (await alreadyProcessed(msgSid)) return new NextResponse('', { status: 200 });

  // Resolve the user's text: a voice note becomes a transcript; otherwise the typed body.
  let userText = String(params.Body || '').trim();
  const numMedia = parseInt(params.NumMedia || '0', 10) || 0;
  if (numMedia > 0 && params.MediaUrl0) {
    try {
      const { buf, mime } = await fetchTwilioMedia(params.MediaUrl0);
      if (/audio|ogg|mpeg|mp4|amr|wav/i.test(mime)) {
        const t = await transcribeAudio(buf, mime);
        if (t) userText = userText ? `${userText}\n${t}` : t;
      }
    } catch (e) { console.error('sarah voice note', e?.message || e); }
  }

  if (!userText) {
    await sendWhatsApp({ to: from, from: to, body: 'Hi — send me a message or a voice note and I’ll get on it.' });
    return new NextResponse('', { status: 200 });
  }

  try {
    await appendMessage(sender, 'user', userText, msgSid);
    const thread = await loadThread(sender, 20);
    const { reply } = await runSarah({ messages: thread });
    await appendMessage(sender, 'assistant', reply);

    // Voice-back: synthesize the reply and host it on the public Blob store so
    // Twilio can fetch it as a WhatsApp voice note. Text always goes too.
    let mediaUrl = null;
    if (voiceConfigured()) {
      try {
        const mp3 = await synthesizeSpeech(reply);
        if (mp3) {
          const name = `sarah-voice/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp3`;
          const { url } = await put(name, mp3, { access: 'public', contentType: 'audio/mpeg', token: process.env.BLOB_READ_WRITE_TOKEN });
          mediaUrl = url;
        }
      } catch (e) { console.error('sarah tts/blob', e?.message || e); }
    }

    await sendWhatsApp({ to: from, from: to, body: reply, mediaUrl });
  } catch (e) {
    console.error('sarah whatsapp run', e?.message || e);
    await sendWhatsApp({ to: from, from: to, body: 'Sorry — I hit a snag. Try me again in a moment.' }).catch(() => {});
  }

  return new NextResponse('', { status: 200 });
}

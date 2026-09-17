// One request/response shape for every door into the assistant — the web
// widget, RS Ops, and the native app. A turn is either JSON `{ text }` or a
// multipart form carrying an `audio` recording; either way it can ask for the
// reply spoken back (`speak`), which comes back inline as base64 mp3 so a phone
// can play it without a second round trip.
import { NextResponse } from 'next/server';
import { query } from '../db';
import { voiceConfigured, transcribeWithLanguage, synthesizeSpeech } from '../voice';
import { runAssistant } from './engine';
import { ensureAssistantSchema, recentMessages, openPending } from './store';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
// Per person, rows in Postgres (serverless instances don't share memory). A
// crew member working all day is nowhere near it; a stuck client looping is.
const RATE_MAX = Number(process.env.ASSISTANT_RATE_MAX || 40);
const RATE_MINUTES = 10;

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

export async function readTurn(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData();
    const audio = form.get('audio');
    const fields = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
    let buf = null;
    let mime = null;
    if (audio && typeof audio === 'object' && typeof audio.arrayBuffer === 'function') {
      if (audio.size > MAX_AUDIO_BYTES) throw Object.assign(new Error('That recording is too long — keep it under a minute.'), { status: 413 });
      buf = Buffer.from(await audio.arrayBuffer());
      mime = audio.type || 'audio/webm';
    }
    return { ...fields, audio: buf, mime, speak: truthy(fields.speak) };
  }
  const body = await req.json().catch(() => ({}));
  return { ...body, audio: null, speak: truthy(body.speak) };
}

async function rateLimited(person) {
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM assistant_messages m JOIN assistant_threads t ON t.id = m.thread_id
        WHERE t.person_key = $1 AND m.role = 'user' AND m.at > now() - make_interval(mins => $2::int)`,
      [person.key, RATE_MINUTES]
    );
    return (rows[0]?.n || 0) >= RATE_MAX;
  } catch {
    return false; // degrade open: a crew member must not be locked out by a DB blip
  }
}

export async function handleTurn(person, turn) {
  await ensureAssistantSchema();
  if (await rateLimited(person)) {
    return NextResponse.json({ error: 'That is a lot of questions in a few minutes — give it a moment.' }, { status: 429 });
  }

  let text = String(turn.text || '').trim();
  let lang = null;
  let via = 'text';
  if (turn.audio) {
    if (!voiceConfigured()) {
      return NextResponse.json({ error: 'Voice is not switched on here yet (ELEVENLABS_API_KEY). Type it instead.' }, { status: 503 });
    }
    const heard = await transcribeWithLanguage(turn.audio, turn.mime);
    text = heard.text;
    lang = heard.lang;
    via = 'voice';
    if (!text) return NextResponse.json({ error: "I didn't catch that — try again a little closer to the phone." }, { status: 422 });
  }
  if (!text) return NextResponse.json({ error: 'Say or type something first.' }, { status: 400 });

  const out = await runAssistant({ person, text, lang, threadId: turn.threadId, via });

  let audio = null;
  if (turn.speak && out.reply && voiceConfigured()) {
    const mp3 = await synthesizeSpeech(out.reply, { format: 'mp3', lang });
    if (mp3) audio = { mime: 'audio/mpeg', base64: mp3.toString('base64') };
  }
  return NextResponse.json({ ...out, heard: via === 'voice' ? text : null, lang, audio });
}

export async function handleHistory(person, threadId) {
  await ensureAssistantSchema();
  const id = Number(threadId) || null;
  const [messages, pending] = id
    ? await Promise.all([recentMessages(person, id), openPending(person, id)])
    : [[], []];
  return NextResponse.json({
    ok: true,
    name: person.name,
    teams: person.teams,
    voice: voiceConfigured(),
    threadId: messages.length ? id : null,
    messages,
    pending: pending.map((p) => ({ id: p.id, readback: p.readback }))
  });
}

export function failure(e) {
  console.error('assistant route failed', e?.message || e);
  return NextResponse.json({ error: e?.status ? e.message : 'The assistant hit a problem — try again.' }, { status: e?.status || 500 });
}

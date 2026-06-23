// Sarah's voice — ElevenLabs for BOTH speech-to-text (Scribe) and text-to-speech.
// One key (ELEVENLABS_API_KEY) does both ears and voice. Everything degrades
// gracefully: with no key, transcription returns '' and synthesis returns null,
// so the channel quietly falls back to text-only.
const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
// A warm, natural default voice; override with ELEVENLABS_VOICE_ID to pick your
// own "Sarah" from the ElevenLabs voice library.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';

export function voiceConfigured() {
  return !!process.env.ELEVENLABS_API_KEY;
}

// audio: Buffer of the voice note. Returns the transcript ('' on failure).
export async function transcribeAudio(audio, mime = 'audio/ogg') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !audio) return '';
  try {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('file', new Blob([audio], { type: mime }), 'note');
    const resp = await fetch(STT_URL, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
    if (!resp.ok) { console.error('elevenlabs STT', resp.status, await resp.text().catch(() => '')); return ''; }
    const data = await resp.json();
    return String(data?.text || '').trim();
  } catch (e) {
    console.error('transcribeAudio failed', e?.message || e);
    return '';
  }
}

// Returns an mp3 Buffer of the spoken reply, or null (not configured / failed).
export async function synthesizeSpeech(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  const say = String(text || '').trim();
  if (!key || !say) return null;
  try {
    const resp = await fetch(`${TTS_BASE}/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: say.slice(0, 2500), model_id: 'eleven_turbo_v2_5' })
    });
    if (!resp.ok) { console.error('elevenlabs TTS', resp.status, await resp.text().catch(() => '')); return null; }
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    console.error('synthesizeSpeech failed', e?.message || e);
    return null;
  }
}

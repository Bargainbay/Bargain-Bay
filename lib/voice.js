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

// Returns an audio Buffer of the spoken reply, or null (not configured / failed).
// format selects the container/codec:
//   'mp3' (default) → mp3_44100_128, for WhatsApp/Twilio + our own audio route.
//   'ogg'           → opus_48000_64, an Ogg-Opus voice note for Telegram sendVoice.
export async function synthesizeSpeech(text, { format = 'mp3' } = {}) {
  const key = process.env.ELEVENLABS_API_KEY;
  const say = String(text || '').trim();
  if (!key || !say) return null;
  const ogg = format === 'ogg';
  const outputFormat = ogg ? 'opus_48000_64' : 'mp3_44100_128';
  const accept = ogg ? 'audio/ogg' : 'audio/mpeg';
  try {
    // Quality > latency for a voice note: the multilingual_v2 model is clearer
    // and better-paced than the turbo model (override via ELEVENLABS_MODEL).
    // Voice settings tuned for measured, clear delivery.
    const resp = await fetch(`${TTS_BASE}/${VOICE_ID}?output_format=${outputFormat}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept },
      body: JSON.stringify({
        text: say.slice(0, 2500),
        model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true }
      })
    });
    if (!resp.ok) { console.error('elevenlabs TTS', resp.status, await resp.text().catch(() => '')); return null; }
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    console.error('synthesizeSpeech failed', e?.message || e);
    return null;
  }
}

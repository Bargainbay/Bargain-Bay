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
  return (await transcribeWithLanguage(audio, mime)).text;
}

// The same transcription, plus the language Scribe heard it in. The team
// assistant answers in whatever language somebody SPOKE, so the detected code
// matters as much as the words. Scribe reports ISO-639-3 ("tam", "pan");
// langCode() folds that to the two-letter form everything else here uses.
export async function transcribeWithLanguage(audio, mime = 'audio/ogg') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !audio) return { text: '', lang: null };
  try {
    const form = new FormData();
    form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
    form.append('file', new Blob([audio], { type: mime }), 'note');
    const resp = await fetch(STT_URL, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
    if (!resp.ok) { console.error('elevenlabs STT', resp.status, await resp.text().catch(() => '')); return { text: '', lang: null }; }
    const data = await resp.json();
    return { text: String(data?.text || '').trim(), lang: langCode(data?.language_code) };
  } catch (e) {
    console.error('transcribeAudio failed', e?.message || e);
    return { text: '', lang: null };
  }
}

const ISO3 = { eng: 'en', tam: 'ta', pan: 'pa', hin: 'hi', urd: 'ur', spa: 'es', fra: 'fr', guj: 'gu', ben: 'bn', tel: 'te', mal: 'ml', ara: 'ar', por: 'pt', ita: 'it', tgl: 'tl', fil: 'tl', vie: 'vi', zho: 'zh', cmn: 'zh', yue: 'zh', kor: 'ko', pol: 'pl', rus: 'ru', ukr: 'uk', fas: 'fa', per: 'fa' };
export function langCode(v) {
  const s = String(v || '').trim().toLowerCase().split(/[-_]/)[0];
  if (!s) return null;
  if (s.length === 2) return s;
  return ISO3[s] || s;
}

// Punjabi is the one language the team asked for that eleven_multilingual_v2
// cannot speak — only the v3 model lists it (checked 2026-09-17). Everything
// else stays on the model that has been reading Sarah's replies aloud.
const V3_ONLY = new Set(['pa']);

// Returns an audio Buffer of the spoken reply, or null (not configured / failed).
// format selects the container/codec:
//   'mp3' (default) → mp3_44100_128, for WhatsApp/Twilio + our own audio route.
//   'ogg'           → opus_48000_64, an Ogg-Opus voice note for Telegram sendVoice.
export async function synthesizeSpeech(text, { format = 'mp3', lang = null } = {}) {
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
        model_id: V3_ONLY.has(langCode(lang))
          ? (process.env.ELEVENLABS_MODEL_V3 || 'eleven_v3')
          : (process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'),
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

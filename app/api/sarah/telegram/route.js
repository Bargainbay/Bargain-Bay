// Sarah on Telegram — the team channel. Handles DMs (admins only, full access)
// and a designated team group (everyone gets inventory lookups; admins get the
// full tool set). Same Sarah brain as WhatsApp/web, role-gated per sender.
// Voice notes are transcribed in; in DMs she also replies with a spoken note.
//
// Dormant until env is set: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// SARAH_TELEGRAM_ADMINS (Telegram user ids), SARAH_TELEGRAM_GROUP_ID.
import { NextResponse } from 'next/server';
import { runSarah } from '../../../../lib/sarah';
import { loadThread, appendMessage } from '../../../../lib/sarah-threads';
import { verifyTelegramSecret, getBotUsername, sendMessage, sendChatAction, downloadFile, sendVoice } from '../../../../lib/telegram';
import { voiceConfigured, transcribeAudio, synthesizeSpeech } from '../../../../lib/voice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ok = () => NextResponse.json({ ok: true });
const adminIds = () => (process.env.SARAH_TELEGRAM_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);

export async function POST(req) {
  if (!verifyTelegramSecret(req)) return new NextResponse('forbidden', { status: 403 });

  let update;
  try { update = await req.json(); } catch { return ok(); }
  const msg = update.message;
  if (!msg || !msg.chat) return ok();

  const chatId = msg.chat.id;
  const chatType = msg.chat.type; // private | group | supergroup
  const from = msg.from || {};
  const userId = String(from.id || '');
  const fromName = from.first_name || from.username || 'Someone';
  const text = String(msg.text || '').trim();
  // A voice note or an audio file carries a downloadable file_id; transcribe it.
  const voice = msg.voice || msg.audio || null;

  // Bootstrapping aid: log who's messaging + the chat id, so the owner can fill
  // SARAH_TELEGRAM_ADMINS / SARAH_TELEGRAM_GROUP_ID from the Vercel logs.
  console.log('telegram msg', { chatId, chatType, userId, username: from.username || '', isVoice: !!voice, isAdmin: adminIds().includes(userId) });

  if (!text && !voice) return ok(); // nothing we can act on (photo, sticker, etc.)

  const isAdmin = adminIds().includes(userId);
  const allowedGroup = process.env.SARAH_TELEGRAM_GROUP_ID;
  let readOnly;

  // Decide whether Sarah should engage with this message BEFORE transcribing
  // (so we never spend an STT call on a group voice note that isn't for her).
  if (chatType === 'private') {
    if (!isAdmin) return ok();          // only owner/partner may DM Sarah
    readOnly = false;
  } else if (chatType === 'group' || chatType === 'supergroup') {
    if (!allowedGroup || String(chatId) !== String(allowedGroup)) return ok(); // only the team group
    const botU = (await getBotUsername()).toLowerCase();
    const repliedToBot = (msg.reply_to_message?.from?.username || '').toLowerCase() === botU && !!botU;
    // Text can address her by @mention, reply, or /command; a voice note can't
    // carry a mention, so in a group she only takes voice when it replies to her.
    const mentioned = !!text && botU && text.toLowerCase().includes('@' + botU);
    const isCommand = text.startsWith('/');
    const addressed = repliedToBot || (!!text && (mentioned || isCommand));
    if (!addressed) return ok();
    readOnly = !isAdmin;                // admins keep full power even in the group
  } else {
    return ok();
  }

  sendChatAction(chatId, 'typing');

  // Resolve the user's words: transcript for a voice note, otherwise the text.
  let prompt = text;
  const wasVoice = !!voice;
  if (voice) {
    try {
      const file = await downloadFile(voice.file_id);
      if (file) {
        const t = await transcribeAudio(file.buf, voice.mime_type || file.mime);
        if (t) prompt = text ? `${text}\n${t}` : t;
      }
    } catch (e) { console.error('telegram voice note', e?.message || e); }
    if (!prompt) {
      await sendMessage(chatId, 'I couldn’t make out that voice note — mind sending it again or typing it?');
      return ok();
    }
  }

  // In a group, strip the @mention / leading command so the prompt is clean.
  if (chatType !== 'private') {
    const botU = (await getBotUsername()).toLowerCase();
    if (botU) prompt = prompt.replace(new RegExp('@' + botU, 'ig'), '').trim();
    prompt = prompt.replace(/^\/\w+@?\w*\s*/, '').trim() || prompt;
  }
  if (!prompt) return ok();

  try {
    const threadKey = `tg:${chatId}`;
    // In a group, prefix the speaker so Sarah can follow a multi-person thread.
    const stored = chatType === 'private' ? prompt : `${fromName}: ${prompt}`;
    await appendMessage(threadKey, 'user', stored);
    const thread = await loadThread(threadKey, 20);
    const { reply } = await runSarah({ messages: thread, readOnly });
    await appendMessage(threadKey, 'assistant', reply);

    // Always send the text. In a 1:1 DM, if they spoke to her, speak back too —
    // voice notes in a busy team group are noisy, so groups stay text-only.
    if (wasVoice && chatType === 'private' && voiceConfigured()) {
      try {
        const ogg = await synthesizeSpeech(reply, { format: 'ogg' });
        if (ogg) await sendVoice(chatId, ogg);
      } catch (e) { console.error('telegram tts', e?.message || e); }
    }
    await sendMessage(chatId, reply);
  } catch (e) {
    console.error('sarah telegram run', e?.message || e);
    await sendMessage(chatId, 'Sorry — I hit a snag. Try me again in a moment.');
  }
  return ok();
}

// Sarah on Telegram — the team channel. Handles DMs (admins only, full access)
// and a designated team group (everyone gets inventory lookups; admins get the
// full tool set). Same Sarah brain as WhatsApp/web, role-gated per sender.
//
// Dormant until env is set: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// SARAH_TELEGRAM_ADMINS (Telegram user ids), SARAH_TELEGRAM_GROUP_ID.
import { NextResponse } from 'next/server';
import { runSarah } from '../../../../lib/sarah';
import { loadThread, appendMessage } from '../../../../lib/sarah-threads';
import { verifyTelegramSecret, getBotUsername, sendMessage, sendChatAction } from '../../../../lib/telegram';

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

  // Bootstrapping aid: log who's messaging + the chat id, so the owner can fill
  // SARAH_TELEGRAM_ADMINS / SARAH_TELEGRAM_GROUP_ID from the Vercel logs.
  console.log('telegram msg', { chatId, chatType, userId, username: from.username || '', isAdmin: adminIds().includes(userId) });

  if (!text) return ok(); // text only for now (voice notes are a later phase)

  const isAdmin = adminIds().includes(userId);
  const allowedGroup = process.env.SARAH_TELEGRAM_GROUP_ID;
  let prompt = text;
  let readOnly;

  if (chatType === 'private') {
    if (!isAdmin) return ok();          // only owner/partner may DM Sarah
    readOnly = false;
  } else if (chatType === 'group' || chatType === 'supergroup') {
    if (!allowedGroup || String(chatId) !== String(allowedGroup)) return ok(); // only the team group
    // In a group, only respond when actually addressed (mention / reply / command).
    const botU = (await getBotUsername()).toLowerCase();
    const mentioned = botU && text.toLowerCase().includes('@' + botU);
    const repliedToBot = (msg.reply_to_message?.from?.username || '').toLowerCase() === botU && !!botU;
    const isCommand = text.startsWith('/');
    if (!mentioned && !repliedToBot && !isCommand) return ok();
    readOnly = !isAdmin;                // admins keep full power even in the group
    if (botU) prompt = prompt.replace(new RegExp('@' + botU, 'ig'), '').trim();
    prompt = prompt.replace(/^\/\w+@?\w*\s*/, '').trim() || prompt;
  } else {
    return ok();
  }

  if (!prompt) return ok();
  sendChatAction(chatId, 'typing');

  try {
    const threadKey = `tg:${chatId}`;
    // In a group, prefix the speaker so Sarah can follow a multi-person thread.
    const stored = chatType === 'private' ? prompt : `${fromName}: ${prompt}`;
    await appendMessage(threadKey, 'user', stored);
    const thread = await loadThread(threadKey, 20);
    const { reply } = await runSarah({ messages: thread, readOnly });
    await appendMessage(threadKey, 'assistant', reply);
    await sendMessage(chatId, reply);
  } catch (e) {
    console.error('sarah telegram run', e?.message || e);
    await sendMessage(chatId, 'Sorry — I hit a snag. Try me again in a moment.');
  }
  return ok();
}

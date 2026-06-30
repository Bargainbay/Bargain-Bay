// Sarah on Telegram — the team channel. Handles DMs (admins only, full access)
// and department team groups (mapped via SARAH_TELEGRAM_DEPT_GROUPS / the main
// SARAH_TELEGRAM_GROUP_ID). Same Sarah brain as WhatsApp/web, role-gated.
//
// In a group she behaves like a natural participant: she reads the conversation
// and only replies when someone's actually talking to her or asking something
// she handles — no @-tag required — and stays out when teammates talk to each
// other. Voice notes are transcribed and treated exactly like text; in a 1:1 DM
// she also replies with a spoken note (groups stay text-only to avoid noise).
//
// Dormant until env is set: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// SARAH_TELEGRAM_ADMINS, and SARAH_TELEGRAM_GROUP_ID / SARAH_TELEGRAM_DEPT_GROUPS.
import { NextResponse } from 'next/server';
import { runAgent } from '../../../../lib/sarah';
import { getAgent } from '../../../../lib/agents/registry';
import { couldBeForBot, isAddressedToBot } from '../../../../lib/agents/addressing';
import { loadThread, appendMessage } from '../../../../lib/sarah-threads';
import { verifyTelegramSecret, getBotUsername, sendMessage, sendChatAction, downloadFile, sendVoice } from '../../../../lib/telegram';
import { openEscalationByMessage, openSingleEscalation, resolveEscalation } from '../../../../lib/escalations';
import { appendToPlaybook } from '../../../../lib/playbook';
import { voiceConfigured, transcribeAudio, synthesizeSpeech } from '../../../../lib/voice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The name people call the bot in chat, regardless of which agent fronts a group.
const BOT_NAME = 'Sarah';

const ok = () => NextResponse.json({ ok: true });
const adminIds = () => (process.env.SARAH_TELEGRAM_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Which front agent answers a given group. The main team group (SARAH_TELEGRAM_GROUP_ID)
// is fronted by Sarah. Department groups are mapped via SARAH_TELEGRAM_DEPT_GROUPS,
// a CSV of "chatId:agentKey" pairs (e.g. "-1001234:delivery_dispatch,-1009876:sales"),
// so the drivers' group talks to Delivery Dispatch, the sales group to Sales, etc.
// Returns the agentKey for an allowed group, or null if the group isn't recognized.
function agentForGroup(chatId) {
  const id = String(chatId);
  if (process.env.SARAH_TELEGRAM_GROUP_ID && id === String(process.env.SARAH_TELEGRAM_GROUP_ID)) return 'sarah';
  // The Management oversight group is fronted by Sarah (the chief).
  if (process.env.SARAH_TELEGRAM_MGMT_GROUP && id === String(process.env.SARAH_TELEGRAM_MGMT_GROUP)) return 'sarah';
  for (const pair of (process.env.SARAH_TELEGRAM_DEPT_GROUPS || '').split(',')) {
    const [gid, key] = pair.split(':').map((s) => s.trim());
    if (gid && key && gid === id) return getAgent(key).key;
  }
  return null;
}

// In the Management group, an owner replying to an escalation message resolves it:
// relay the answer to the chat it came from and (auto-learn) save it to the
// playbook. Returns true if it handled the message.
async function resolveEscalationReply(msg, answer) {
  const replied = msg.reply_to_message;
  // Prefer an explicit reply (matches the exact escalation). If the owner just
  // typed an answer without using Telegram's reply, fall back to the single open
  // escalation — only when there's exactly one, so we never mis-attribute.
  let esc = replied ? await openEscalationByMessage(replied.message_id) : null;
  if (!esc && !replied) esc = await openSingleEscalation();
  if (!esc) return false;
  await resolveEscalation(esc.id, answer);
  if (esc.origin_chat_id) {
    await sendMessage(esc.origin_chat_id, `📋 Update from management:\n\n${answer}`);
  }
  try { await appendToPlaybook(`When asked: "${esc.question}" → ${answer}`, esc.dept || undefined); } catch (e) { console.error('escalation remember', e?.message || e); }
  await sendMessage(msg.chat.id, `Got it — relayed to ${esc.dept || 'the team'} and saved so I handle it myself next time. ✅`);
  return true;
}

// Transcribe a voice/audio note to text (or '' if it can't be made out).
async function transcribe(voice) {
  try {
    const file = await downloadFile(voice.file_id);
    if (file) return (await transcribeAudio(file.buf, voice.mime_type || file.mime)) || '';
  } catch (e) { console.error('telegram voice note', e?.message || e); }
  return '';
}

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
  const voice = msg.voice || msg.audio || null; // a downloadable voice/audio note
  const isAdmin = adminIds().includes(userId);
  const inGroup = chatType === 'group' || chatType === 'supergroup';

  console.log('telegram msg', { chatId, chatType, userId, username: from.username || '', isVoice: !!voice, isAdmin });

  if (!text && !voice) return ok(); // nothing we can act on (photo, sticker, etc.)

  // Utility: any admin can ask for the current chat's id — handy when wiring up a
  // new group (drivers, management, etc.). Runs before the group-routing gate so
  // it answers even in a group that isn't configured yet.
  if (isAdmin && /^\/chatid(@\w+)?$/i.test(text.trim())) {
    await sendMessage(chatId, `Chat ID: ${chatId}\nType: ${chatType}`);
    return ok();
  }

  // Who answers, and may this chat use Sarah at all?
  let readOnly;
  let agentKey = 'sarah';
  if (chatType === 'private') {
    if (!isAdmin) return ok();          // only owner/partner may DM Sarah
    readOnly = false;
  } else if (inGroup) {
    agentKey = agentForGroup(chatId);
    if (!agentKey) return ok();         // only the team group / mapped dept groups
    readOnly = !isAdmin;               // admins keep full power even in the group
  } else {
    return ok();
  }

  // Resolve the words: a voice note becomes a transcript so text and voice are
  // handled identically from here on.
  let prompt = text;
  const wasVoice = !!voice;
  if (voice) {
    const t = await transcribe(voice);
    if (t) prompt = text ? `${text}\n${t}` : t;
    if (!prompt) {
      // Never nag a group over an unclear note; in a DM, ask for a resend.
      if (!inGroup) await sendMessage(chatId, 'I couldn’t make out that voice note — mind sending it again or typing it?');
      return ok();
    }
  }

  const threadKey = `tg:${chatId}`;

  if (inGroup) {
    const botU = (await getBotUsername()).toLowerCase();
    const repliedToBot = (msg.reply_to_message?.from?.username || '').toLowerCase() === botU && !!botU;
    const mentioned = !!text && botU && text.toLowerCase().includes('@' + botU);
    const isCommand = text.startsWith('/');
    // Clean the @mention / leading command so the stored + sent prompt is tidy.
    if (botU) prompt = prompt.replace(new RegExp('@' + botU, 'ig'), '').trim();
    prompt = prompt.replace(/^\/\w+@?\w*\s*/, '').trim() || prompt;
    if (!prompt) return ok();

    // Log every group message (with speaker) so she follows the conversation —
    // context for both the addressing decision and her own reply — even when she
    // stays quiet.
    await appendMessage(threadKey, 'user', `${fromName}: ${prompt}`);

    // Management group: an owner replying to an escalation answers it outright —
    // relay it back to where it came from and learn it, no agent run needed.
    if (isAdmin && process.env.SARAH_TELEGRAM_MGMT_GROUP && String(chatId) === String(process.env.SARAH_TELEGRAM_MGMT_GROUP)) {
      try { if (await resolveEscalationReply(msg, prompt)) return ok(); } catch (e) { console.error('resolve escalation', e?.message || e); }
    }

    // Decide whether she's actually being addressed. Explicit signals win for
    // free; otherwise a fast judge reads the recent chat, but only for messages
    // that look like a question/request (pure chatter never triggers a call).
    const nameMentioned = new RegExp(`\\b${BOT_NAME}\\b`, 'i').test(prompt);
    let engage = repliedToBot || mentioned || isCommand || nameMentioned;
    if (!engage && couldBeForBot(prompt)) {
      const recent = await loadThread(threadKey, 12);
      engage = await isAddressedToBot({ recent: recent.slice(0, -1), latest: `${fromName}: ${prompt}`, botName: BOT_NAME });
    }
    if (!engage) return ok(); // she's listening, but this one isn't for her

    sendChatAction(chatId, 'typing');
    try {
      const thread = await loadThread(threadKey, 20);
      const { reply } = await runAgent({ agentKey, messages: thread, readOnly, ctx: { originChatId: chatId, dept: getAgent(agentKey).dept, senderName: fromName } });
      await appendMessage(threadKey, 'assistant', reply);
      await sendMessage(chatId, reply); // groups stay text-only
    } catch (e) {
      console.error('sarah telegram run', e?.message || e);
      await sendMessage(chatId, 'Sorry — I hit a snag. Try me again in a moment.');
    }
    return ok();
  }

  // Private DM (owner / partner): always engage; if they spoke, speak back too.
  sendChatAction(chatId, 'typing');
  try {
    await appendMessage(threadKey, 'user', prompt);
    const thread = await loadThread(threadKey, 20);
    const { reply } = await runAgent({ agentKey, messages: thread, readOnly, ctx: { originChatId: chatId, dept: getAgent(agentKey).dept, senderName: fromName } });
    await appendMessage(threadKey, 'assistant', reply);
    if (wasVoice && voiceConfigured()) {
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

// Telegram Bot API helpers for Sarah's team channel. The bot token comes from
// @BotFather (TELEGRAM_BOT_TOKEN). Everything degrades to no-op if unset.
const API = (token) => `https://api.telegram.org/bot${token}`;

export function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

// Telegram stamps every webhook call with the secret we registered via setWebhook,
// proving the request is really from Telegram (not a forged update).
export function verifyTelegramSecret(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Fail CLOSED in production: with no secret set, an unauthenticated POST could
  // forge an admin update and drive the agent into actions. Only allow the unset
  // bypass outside production so the webhook can still be exercised locally.
  if (!expected) return process.env.NODE_ENV !== 'production';
  return req.headers.get('x-telegram-bot-api-secret-token') === expected;
}

let _username = null;
export async function getBotUsername() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return '';
  if (_username !== null) return _username;
  try {
    const r = await fetch(`${API(token)}/getMe`);
    const d = await r.json();
    _username = d?.result?.username || '';
  } catch { _username = ''; }
  return _username;
}

export async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !text) return;
  await fetch(`${API(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) })
  }).catch((e) => console.error('telegram sendMessage', e?.message || e));
}

// Like sendMessage but returns the sent message_id (used to link an escalation
// to the owner's reply). Returns null on failure.
export async function sendAndGetId(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !text) return null;
  try {
    const res = await fetch(`${API(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) })
    });
    const data = await res.json().catch(() => null);
    return data?.result?.message_id ?? null;
  } catch (e) { console.error('telegram sendAndGetId', e?.message || e); return null; }
}

// Fire-and-forget "Sarah is typing…" indicator.
export function sendChatAction(chatId, action = 'typing') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  fetch(`${API(token)}/sendChatAction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action })
  }).catch(() => {});
}

// --- Voice notes ----------------------------------------------------------
// Download an incoming file (voice note / audio) by its Telegram file_id.
// Two steps: getFile resolves the file_path, then we fetch the file bytes from
// the file API. Returns { buf, mime } or null on failure.
export async function downloadFile(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !fileId) return null;
  try {
    const meta = await fetch(`${API(token)}/getFile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    }).then((r) => r.json());
    const path = meta?.result?.file_path;
    if (!path) return null;
    const resp = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    if (!resp.ok) { console.error('telegram downloadFile', resp.status); return null; }
    const mime = resp.headers.get('content-type') || (path.endsWith('.oga') || path.endsWith('.ogg') ? 'audio/ogg' : 'application/octet-stream');
    return { buf: Buffer.from(await resp.arrayBuffer()), mime };
  } catch (e) {
    console.error('telegram downloadFile failed', e?.message || e);
    return null;
  }
}

// Send a voice note (Ogg-Opus buffer) to a chat, with a text caption fallback.
export async function sendVoice(chatId, oggBuffer, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !oggBuffer) return false;
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', new Blob([oggBuffer], { type: 'audio/ogg' }), 'sarah.ogg');
    if (caption) form.append('caption', String(caption).slice(0, 1000));
    const resp = await fetch(`${API(token)}/sendVoice`, { method: 'POST', body: form });
    if (!resp.ok) { console.error('telegram sendVoice', resp.status, await resp.text().catch(() => '')); return false; }
    return true;
  } catch (e) {
    console.error('telegram sendVoice failed', e?.message || e);
    return false;
  }
}

// Register the webhook so Telegram delivers updates to our route.
export async function setWebhook(url, secret) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
  const r = await fetch(`${API(token)}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret || undefined, allowed_updates: ['message'] })
  });
  return r.json();
}

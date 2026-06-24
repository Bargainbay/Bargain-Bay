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
  if (!expected) return true; // not enforced until the secret is set
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

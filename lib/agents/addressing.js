// Natural group conversation: decide whether Sarah should jump into a team-group
// message. She answers when someone's talking TO her or asking something she
// handles, and stays quiet when teammates are talking to EACH OTHER — so the
// group feels like a normal conversation, not a bot that needs @-tagging.
//
// Two cheap gates before any model call:
//   1. couldBeForBot() — pure chatter ("ok", "thanks", "on my way") is skipped
//      outright; we only deliberate on things that look like a question/request.
//   2. isAddressedToBot() — a fast, tiny model call that reads the recent chat
//      and answers YES/NO. Fails safe to NO (stay quiet) so an error or missing
//      key never makes her talk over the team.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// A small, fast model is plenty for a one-word YES/NO; override if needed.
const MODEL = process.env.AGENT_ADDRESSING_MODEL || 'claude-haiku-4-5-20251001';

// Words/shapes that suggest the message wants help (vs. teammates chatting).
const INTENT = /(\?|price|cost|how much|how many|stock|inventory|available|do we have|have we got|in stock|left|fridge|refrigerator|stove|range|oven|cooktop|washer|dryer|dishwasher|freezer|microwave|hood|model|sku|invoice|quote|deliver|delivery|pickup|warranty|return|exchange|refund|discount|deal|bundle|hold|reserve|markdown|clearance|what'?s? the|can (we|you|i)|should (we|i))/i;

// Is this even worth deliberating over? Cheap regex; no network.
export function couldBeForBot(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return INTENT.test(t);
}

// Ask the fast model whether the latest message is for the bot, given context.
// recent: [{ role:'user'|'assistant', content }] oldest→newest (the bot's own
// turns are role 'assistant'). latest: the new message text (with speaker name).
export async function isAddressedToBot({ recent = [], latest, botName = 'Sarah' }) {
  const key = process.env.ANTHROPIC_API_KEY;
  const msg = String(latest || '').trim();
  if (!key || !msg) return false;

  const convo = recent.slice(-8)
    .map((m) => `${m.role === 'assistant' ? botName : (m.content.includes(':') ? '' : 'Member: ')}${m.content}`)
    .join('\n');

  const system =
    `You are a router for ${botName}, an AI assistant in a small appliance-business team group chat. ` +
    `${botName} handles inventory, pricing, quotes, invoices, orders, deliveries, and customer questions. ` +
    `Decide if ${botName} should reply to the LATEST message. ` +
    `Answer YES only if the latest message is addressed to ${botName}, or is a question/request ${botName} should handle. ` +
    `Answer NO if teammates are talking to each other, or it's casual chatter that doesn't need ${botName}. ` +
    `Reply with exactly one word: YES or NO.`;
  const user = `${convo ? 'Recent chat:\n' + convo + '\n\n' : ''}Latest message:\n${msg}\n\nShould ${botName} reply?`;

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 5, system, messages: [{ role: 'user', content: user }] })
    });
    if (!resp.ok) { console.error('addressing', resp.status, await resp.text().catch(() => '')); return false; }
    const data = await resp.json();
    const out = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').toUpperCase();
    return /\bYES\b/.test(out);
  } catch (e) {
    console.error('isAddressedToBot failed', e?.message || e);
    return false;
  }
}

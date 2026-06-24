// Sarah — the channel-agnostic Operations Copilot core. ONE agentic loop that
// the web copilot, the WhatsApp webhook, AND the Telegram webhook all call.
// Tools + system prompt live in ./agent-tools; this runs the Anthropic tool-use
// loop. Raw fetch (mirrors /api/chat) — no SDK dependency.
//
// `readOnly` gates a team member to lookup-only tools (see toolsFor).
import { SYSTEM_PROMPT, executeTool, toolsFor, READONLY_NOTE } from './agent-tools';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.AGENT_MODEL || 'claude-opus-4-8';
const MAX_TURNS = 8; // safety cap on tool-use round-trips per request

const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

async function callClaude(key, messages, tools, system) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Anthropic ${resp.status}: ${t.slice(0, 300)}`);
  }
  return resp.json();
}

// messages: [{ role:'user'|'assistant', content:string }] ending in a user turn.
// readOnly: true for team members (lookup tools only). Returns {reply, actions, stopReason}.
export async function runSarah({ messages, readOnly = false }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { reply: 'I’m not fully set up yet — my AI key is missing.', actions: [], stopReason: 'no_key' };

  const tools = toolsFor({ readOnly });
  const system = SYSTEM_PROMPT + (readOnly ? READONLY_NOTE : '');
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const actions = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const data = await callClaude(key, convo, tools, system);

    if (data.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(block.name, block.input);
        actions.push({ name: block.name, ok: !result?.error });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result), is_error: !!result?.error });
      }
      convo.push({ role: 'user', content: results });
      continue;
    }

    let reply = textOf(data.content);
    if (data.stop_reason === 'refusal') reply = reply || 'I can’t help with that one.';
    if (!reply) reply = 'Done.';
    return { reply, actions, stopReason: data.stop_reason };
  }
  return {
    reply: 'That took more steps than expected — I’ve paused. How would you like to continue?',
    actions,
    stopReason: 'max_turns'
  };
}

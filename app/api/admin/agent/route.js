// Ops Copilot — the agentic loop. Admin-only. Takes the conversation so far,
// calls Claude with the invoicing + inventory tools, runs the tool-use loop
// server-side (executing each tool against the existing app machinery), and
// returns the final assistant reply plus a log of the actions it took.
//
// Mirrors the raw-fetch Anthropic pattern already used by /api/chat (no SDK
// dependency). Same brain + tools will later drive the scheduled autopilot.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { TOOLS, SYSTEM_PROMPT, executeTool } from '../../../../lib/agent-tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.AGENT_MODEL || 'claude-opus-4-8';
const MAX_TURNS = 8; // safety cap on tool-use round-trips per request

async function callClaude(key, messages) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages
    })
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return resp.json();
}

const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

export async function POST(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: 'The copilot isn’t configured yet (ANTHROPIC_API_KEY is missing).' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  // Client keeps a plain user/assistant text transcript; tool turns live only
  // inside this request. Trim to the last 20 turns and cap content length.
  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No user message.' }, { status: 400 });
  }

  const actions = [];
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const data = await callClaude(key, messages);

      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: data.content });
        const toolResults = [];
        for (const block of data.content) {
          if (block.type !== 'tool_use') continue;
          const result = await executeTool(block.name, block.input);
          actions.push({ name: block.name, input: block.input, ok: !result?.error, result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
            is_error: !!result?.error
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Terminal: end_turn / max_tokens / refusal
      let reply = textOf(data.content);
      if (data.stop_reason === 'refusal') reply = reply || 'I can’t help with that request.';
      if (!reply) reply = 'Done.';
      return NextResponse.json({ reply, actions, stopReason: data.stop_reason });
    }
    // Ran out of tool-use turns without a final answer.
    return NextResponse.json({
      reply: 'That took more steps than expected — I’ve paused. Tell me how you’d like to continue.',
      actions,
      stopReason: 'max_turns'
    });
  } catch (e) {
    console.error('ops copilot error', e?.message || e);
    return NextResponse.json({ error: 'The copilot hit a snag talking to the model. Try again in a moment.', actions }, { status: 502 });
  }
}

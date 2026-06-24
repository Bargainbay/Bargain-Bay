// The agent engine — ONE channel-agnostic agentic loop that every agent (Sarah
// the orchestrator + the specialists) runs through. The web copilot, WhatsApp,
// and Telegram all call runSarah (= runAgent('sarah', …)); routes that front a
// specialist call runAgent with that agent's key. Raw fetch to Anthropic (mirrors
// /api/chat) — no SDK dependency.
//
//   runAgent({ agentKey, messages, readOnly }) builds the system prompt from the
//   registry (persona + base + autonomy + that agent's playbook), exposes that
//   agent's tool subset, runs the tool-use loop, and — for Sarah — handles the
//   `delegate` tool by recursively running the named specialist sub-agent.
import { executeTool, toolsFor } from './agent-tools';
import { getAgent, buildSystemPrompt, toolsForAgent } from './agents/registry';
import { getAutonomy } from './agents/autonomy';
import { getPlaybook, GLOBAL_DEPT } from './playbook';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.AGENT_MODEL || 'claude-opus-4-8';
const MAX_TURNS = 8;      // safety cap on tool-use round-trips per request
const MAX_DEPTH = 1;      // how deep delegation may nest (Sarah → one specialist)

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

// Run one agent over a conversation.
// - agentKey: which agent (default 'sarah'); messages: [{role,content}] ending in user.
// - readOnly: true for a team member (lookup-only tools, no writes).
// - depth: internal — how many delegate hops deep we are.
// Returns { reply, actions, stopReason }.
export async function runAgent({ agentKey = 'sarah', messages, readOnly = false, depth = 0 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { reply: 'I’m not fully set up yet — my AI key is missing.', actions: [], stopReason: 'no_key' };

  const agent = getAgent(agentKey);
  const [autonomyLevel, globalPlaybook, deptPlaybook] = await Promise.all([
    getAutonomy(agent.key, agent.defaultAutonomy).catch(() => agent.defaultAutonomy),
    getPlaybook().catch(() => ''),
    agent.dept === GLOBAL_DEPT ? Promise.resolve('') : getPlaybook({ dept: agent.dept }).catch(() => '')
  ]);

  const system = buildSystemPrompt(agent, { readOnly, autonomyLevel, globalPlaybook, deptPlaybook });
  const tools = toolsForAgent(agent, toolsFor, { readOnly });
  const canDelegate = agent.canDelegate && !readOnly && depth < MAX_DEPTH;

  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const actions = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const data = await callClaude(key, convo, tools, system);

    if (data.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        if (block.name === 'delegate') {
          // Engine-handled: run the named specialist and feed its reply back.
          result = await runDelegate(block.input, depth);
          actions.push({ name: 'delegate', dept: block.input?.department, ok: !result?.error });
        } else {
          result = await executeTool(block.name, block.input, { dept: agent.dept });
          actions.push({ name: block.name, ok: !result?.error });
        }
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

// Sarah delegating to a specialist: run that agent on the single task and return
// its answer as the tool result. Guarded so specialists can't delegate onward.
async function runDelegate(input, depth) {
  const dept = String(input?.department || '').trim();
  const task = String(input?.task || '').trim();
  const target = getAgent(dept);
  if (!task) return { error: 'Tell the specialist what you need (task is empty).' };
  if (target.key === 'sarah' || target.key !== dept) {
    return { error: `No such specialist: "${dept}".` };
  }
  if (depth >= MAX_DEPTH) {
    return { error: 'Delegation can only go one level deep.' };
  }
  const { reply, actions } = await runAgent({
    agentKey: target.key,
    messages: [{ role: 'user', content: task }],
    readOnly: false,
    depth: depth + 1
  });
  return { department: target.key, specialist: target.name, answer: reply, actionsTaken: actions };
}

// Back-compat: the WhatsApp, Telegram, and web routes call runSarah. It's just
// the orchestrator (Sarah) front agent.
export async function runSarah({ messages, readOnly = false }) {
  return runAgent({ agentKey: 'sarah', messages, readOnly });
}

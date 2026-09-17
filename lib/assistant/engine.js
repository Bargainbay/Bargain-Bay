// The team assistant — the one conversation loop behind the driver app, the
// admin portal, RS Ops and (later) the native app. Every channel hands it a
// person (lib/assistant/people.js) and what they said; it answers in the
// language they spoke, using only their teams' tools.
//
// Raw fetch to the Messages API, the same way lib/sarah.js does it — this repo
// deliberately carries no SDK dependency.
//
// It is NOT Sarah. Sarah is the owner's chief of staff and runs on the owner's
// authority; this answers the crew, on theirs. Sharing her engine would mean
// widening her permission model (read-only vs owner) into per-person, per-team
// identity, and that is a change to the thing the owner talks to every day.
// What IS shared is everything underneath: the playbook sections the owner
// already writes, and the same library functions the screens call.
import crypto from 'crypto';
import { getPlaybook } from '../playbook';
import { torontoToday } from '../jobs';
import { TEAMS } from './people';
import { ALL_TOOLS, apiTools } from './tools';
import {
  ensureAssistantSchema, openThread, loadHistory, appendMessage,
  proposeAction, openPending, takeAction, finishAction, cancelAction, getBanter
} from './store';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5';
// Somebody is standing in a doorway waiting on every one of these. `medium`
// keeps a turn short; the owner can raise it with ASSISTANT_EFFORT.
const EFFORT = process.env.ASSISTANT_EFFORT || 'medium';
const MAX_PASSES = 6;

export const LANGUAGES = {
  en: 'English', ta: 'Tamil', pa: 'Punjabi', hi: 'Hindi', ur: 'Urdu', es: 'Spanish'
};

// Which playbook sections each team reads. The owner writes these on
// /admin/agent for Sarah's managers; the crew assistant follows the same rules
// rather than a second copy of them that could drift.
const TEAM_PLAYBOOK = { driver: 'delivery_dispatch', sales: 'sales', warehouse: 'technical_manager' };

const BASE = `You are the RS Manager — the AI floor manager for RS Solutions and Bargain Bay (liquidation appliances; warehouse at 1135 Squires Beach Rd, Pickering, Ontario). You work alongside the crew: delivery and service drivers, the warehouse and refurb team (RS Ops), and the sales team. People reach you by voice or chat on a phone, often mid-task — carrying a fridge, in a van, at a customer's door, with a unit open on the bench.

HOW YOU TALK
- Reply in the language the person used in their latest message (English, Tamil, Punjabi, Hindi, Urdu, Spanish, or whatever they spoke). Switch when they switch.
- Keep names, street addresses, postal codes, SKUs, part numbers, job and order numbers (RS-1021, BB-1179, INV-1042), spot codes (L3-2) and phone numbers EXACTLY as the tools return them, in Latin script, even inside a reply in another language. Say money as a number with a dollar sign.
- Most replies are read aloud. Short: one to three sentences, no markdown, no bullet lists, no tables, no emoji. Lead with the answer.
- Walking someone through something (a delivery, an install, a diagnosis, a repair) means ONE step at a time: say the step, then wait for them to say done or ask. Never read out a ten-step procedure in one go.
- You are talking to a colleague, not a customer. Plain and direct.

FACTS
- Everything about stops, stock, spots, parts, orders, invoices and customers comes from your tools. Never guess or fill in a number, address, time, price or status. If a tool can't answer, say so and say where to look in the app.
- You only see what the signed-in person's own role allows. If they ask for something outside it (another driver's run, what a unit cost, payroll, another company's books), say it isn't something you can pull up for them — don't hint at the answer.

CHANGES — READ BACK, THEN WAIT FOR YES
- Some tools CHANGE things (marking a stop, moving a unit, requesting a part, messaging dispatch). Calling one does not do it: it returns a read-back and an actionId.
- Say the read-back to the person in their language and ask for a yes. Then STOP and wait for their answer.
- Only when their next message clearly agrees to that exact action, call confirm_action with its actionId. If they say no, correct a detail, or the answer is unclear, call cancel_action or propose again with the corrected detail. A new proposal replaces the old one.
- Never say something is done unless confirm_action came back ok.
- Speech-to-text mishears numbers and codes. If a SKU, spot or job number sounds wrong or doesn't exist, ask them to spell it or read it off the label — do not pick the nearest match on your own.

WHAT STAYS ON THE SCREEN
- Closing a stop (done, or couldn't complete) is the Finish screen in the driver app: signature, photos and the damage questions are a signed form.
- Raising, editing, voiding or refunding an invoice, taking payments, and anything with money is done on the screens. You can price a sale out and tell them what to enter.

REPAIRS AND SAFETY
- You can help diagnose and walk through appliance repairs from the model, the symptoms and any error code, and check the parts shelf. Be honest when something can't be known without the service manual or a meter reading, and say to check the tech sheet (usually taped inside the unit or behind the kick plate).
- Always: unplug or switch off at the breaker before opening a unit, and shut off water before disconnecting lines. Say it at the start of any walkthrough that opens a unit.
- Gas: in Ontario gas appliance work (gas ranges, gas dryers, gas connections, smelling gas) is for a licensed gas technician. If anyone smells gas, tell them to stop, not operate switches, get out and call the gas utility from outside. Do not walk anyone through gas repairs.
- Sealed refrigeration system (compressor, refrigerant lines, recharging, brazing): only a certified refrigerant technician. You can help identify that it's a sealed-system fault; not how to open it.
- Don't advise bypassing safety devices (door switches, thermal fuses, overflow switches, interlocks). A blown thermal fuse means find why it blew.
- Microwaves: the high-voltage capacitor can hold a lethal charge unplugged — internal microwave repair is for someone trained to discharge it.
- Lifting and moving: two people and a dolly for fridges, ranges, washers and dryers; strap it; never carry up stairs alone.

When a question is a judgment call beyond the playbook — a customer dispute, a discount, damage we might pay for — tell them to call dispatch or the owner rather than deciding it yourself.`;


// The driver's version, on by default (the owner's call, 2026-09-17): a driver
// is alone in a van for hours and a manager who only ever recites addresses is
// one they stop talking to — and a driver who has stopped talking to it is one
// who is not marking stops or asking questions either.
//
// The two limits are not squeamishness, they are what keeps this shippable:
// a joke about a customer or about somebody's race is the one that gets
// repeated back in a complaint, and the reply is READ ALOUD, often with the
// customer standing there. Both are in the prompt because the model is the only
// thing that can judge them in the moment.
const BANTER = `
ON THE ROAD — how you talk to a driver
- They are on their own in a van for hours. Be good company: dry, quick, funny. Swearing is fine, and so is dark humour, sarcasm and taking the piss — out of yourself, the traffic, the weather, the appliance, the job, the day. Match how they talk to you; if they swear, swear back.
- If they ask for a joke, a story, something to keep them awake, or just want to talk rubbish for a minute, go with it properly. Be actually funny rather than safe.
- NEVER at the expense of: the customer, their home, their name or their accent; a colleague; or anyone's race, religion, sex, sexuality, body or disability. That line does not move, however they push, and "he started it" is not a reason. Turn it on yourself or on the situation instead — that is usually funnier anyway.
- THE JOB IS SAID STRAIGHT. An address, a phone number, a SKU, an amount, a safety step, or a read-back you need a yes to: no jokes in the same breath. Say it clean, then be yourself again.
- Your replies are READ ALOUD, and a customer is often three feet away. Once they have arrived at a stop, and any time the talk is about the person at the door, keep it clean until they are back in the van.
- If a stop went badly, they sound wound up, or something has actually gone wrong: drop the comedy entirely, sort the problem, and leave the jokes for afterwards.
- Never more than a line or two of nonsense before the answer they asked for. You are a laugh AND useful, in that order when they are chatting and the other way round when they are working.`;

function stableSystem(person, playbooks, banter) {
  const teams = person.teams.map((t) => `- ${TEAMS[t]}`).join('\n');
  const books = playbooks.filter((p) => p.text).map((p) => `### ${p.title}\n${p.text}`).join('\n\n');
  return `${BASE}${banter ? BANTER : ''}

THIS PERSON'S TEAMS
${teams}

${books ? `THE OWNER'S PLAYBOOK (follow it)\n${books}` : ''}`.trim();
}

function volatileSystem(person, pending, lang) {
  const lines = [
    `Signed in: ${person.name}${person.rsopsRole ? ` (RS Ops ${person.rsopsRole})` : ''}.`,
    `Today is ${torontoToday()} (Toronto).`,
    `Channel: ${person.channel}.`
  ];
  if (lang && LANGUAGES[lang]) lines.push(`Their speech was detected as ${LANGUAGES[lang]} — reply in that language unless their words are clearly another.`);
  if (pending.length) {
    lines.push('Waiting for a yes/no on:');
    for (const p of pending) lines.push(`- actionId ${p.id}: ${p.readback}`);
  } else {
    lines.push('Nothing is waiting for a yes.');
  }
  return lines.join('\n');
}

async function callClaude(key, { system, tools, messages }) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // If the model declines a turn, the API re-runs it on a fallback model
      // rather than leaving a driver with no answer.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      fallbacks: 'default',
      system,
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

const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

async function runTool(block, ctx) {
  const { person, thread, requestId } = ctx;
  const input = block.input || {};

  if (block.name === 'confirm_action') {
    const { action, error } = await takeAction({ person, id: input.actionId, requestId });
    if (error) return { error };
    const tool = ALL_TOOLS.find((t) => t.name === action.tool);
    // Re-checked at execution: a person's teams can change between the read-back
    // and the yes (a driver switched off, a rep removed from SALES_EMAILS).
    if (!tool || !tool.teams.some((t) => person.teams.includes(t))) {
      await finishAction(action.id, { ok: false, result: { error: 'not permitted' } });
      return { error: 'That is no longer something this person can do.' };
    }
    try {
      const result = await tool.execute(action.input, ctx);
      await finishAction(action.id, { ok: !result?.error, result });
      return result?.error ? result : { done: true, what: action.readback, ...result };
    } catch (e) {
      await finishAction(action.id, { ok: false, result: { error: e?.message } });
      return { error: e?.message || 'That did not go through.' };
    }
  }

  if (block.name === 'cancel_action') {
    return { cancelled: await cancelAction({ person, id: input.actionId }) };
  }

  const tool = ALL_TOOLS.find((t) => t.name === block.name);
  if (!tool || !tool.teams.some((t) => person.teams.includes(t))) return { error: `No tool called ${block.name}.` };
  try {
    if (!tool.write) return await tool.run(input, ctx);
    const prepared = await tool.prepare(input, ctx);
    if (prepared?.error) return prepared;
    const actionId = await proposeAction({
      person, threadId: thread.id, requestId, tool: tool.name, input: prepared.input, readback: prepared.readback
    });
    return {
      needsYes: true,
      actionId,
      readback: prepared.readback,
      instruction: 'NOT DONE YET. Say this read-back to them in their language and ask for a yes. Do not call confirm_action in this turn.'
    };
  } catch (e) {
    console.error(`assistant tool ${block.name} failed`, e?.message || e);
    return { error: e?.message || `${block.name} failed.` };
  }
}

// person: from people.js. text: what they said (already transcribed).
// lang: the language speech-to-text heard, if it was voice.
// Returns { threadId, reply, actions, pending: [{ id, readback }] }.
export async function runAssistant({ person, text, lang = null, threadId = null, via = 'text' }) {
  const key = process.env.ANTHROPIC_API_KEY;
  const said = String(text || '').trim().slice(0, 4000);
  if (!said) return { threadId, reply: '', actions: [], pending: [] };
  if (!key) return { threadId, reply: 'The assistant is not switched on yet — the AI key is missing.', actions: [], pending: [] };

  await ensureAssistantSchema();
  const thread = await openThread(person, threadId, { channel: person.channel, lang });
  const requestId = crypto.randomUUID();
  const ctx = { person, thread, requestId };

  const books = await Promise.all(person.teams.map(async (team) => ({
    title: TEAMS[team],
    text: await getPlaybook({ dept: TEAM_PLAYBOOK[team] }).catch(() => '')
  })));
  const general = await getPlaybook().catch(() => '');
  const [history, pending, banter] = await Promise.all([
    loadHistory(thread.id), openPending(person, thread.id), getBanter(person).catch(() => false)
  ]);

  // Stable first (cached), per-turn facts after it.
  const system = [
    { type: 'text', text: stableSystem(person, [{ title: 'Company', text: general }, ...books], banter), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: volatileSystem(person, pending, lang) }
  ];
  const tools = apiTools(person);
  const convo = [...history, { role: 'user', content: said }];
  const actions = [];
  let reply = '';

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const data = await callClaude(key, { system, tools, messages: convo });
    if (data.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;
        const result = await runTool(block, ctx);
        actions.push({ tool: block.name, ok: !result?.error, needsYes: !!result?.needsYes, done: !!result?.done });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result), is_error: !!result?.error });
      }
      convo.push({ role: 'user', content: results });
      continue;
    }
    reply = textOf(data.content);
    if (data.stop_reason === 'refusal' && !reply) reply = 'I can’t help with that one — ask dispatch.';
    break;
  }
  if (!reply) reply = 'That took more steps than I expected. Ask me again a simpler way, or check the app.';

  await appendMessage(thread.id, { role: 'user', content: said, lang, via });
  await appendMessage(thread.id, { role: 'assistant', content: reply, lang, actions });
  const stillWaiting = await openPending(person, thread.id);
  return {
    threadId: thread.id,
    reply,
    actions,
    // So a screen can offer Yes / No buttons beside the question.
    pending: stillWaiting.map((p) => ({ id: p.id, readback: p.readback }))
  };
}

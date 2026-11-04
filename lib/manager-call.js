// The Voice Manager: an agent that rings the owner about what is wrong with the
// business, takes his instructions by voice, and fixes what it safely can.
//
// It is built out of what the import-review call already proved works (see
// lib/import-call.js): Twilio's REST API places the call, `<Gather input="speech">`
// loops it, ElevenLabs speaks, and a Claude tool loop decides what to say. Twilio
// runs the loop — one webhook URL, hit again after everything he says — so there
// is no socket to hold open inside a serverless function. The signature check,
// the TwiML writer and the public audio URL are IMPORTED from there, not copied,
// so there is one definition of "this request really came from Twilio".
//
// WHAT IT CAN DO is deliberately a short list (TOOLS below):
//   · read the scan (read-only),
//   · set a model's stock photo, by copying another model's photo — a catalogue
//     write, never money,
//   · refresh the website's stock from the tracker (the same thing the Sync
//     button and the nightly cron do),
//   · snooze an issue, keep a note for later, email him the links.
// It CANNOT touch an invoice, an order, a payment, a customer, a price, a driver
// or a stop. Anything that is a decision about money stays a person's.
//
// **EVERY WRITE NEEDS A SECOND "YES", AND THAT IS ENFORCED HERE, NOT IN THE
// PROMPT.** A write tool only PROPOSES on the turn it is first called: it stores
// the proposal on the call row and returns the read-back. It runs only when the
// SAME tool is called with the SAME arguments on a LATER turn — i.e. after he has
// spoken again. The model cannot confirm its own proposal in the same breath,
// because a speech transcript on a phone line mishears things, and a misheard
// model number or a wrong "yes" is exactly what the read-back exists to catch.
import crypto from 'crypto';
import { outbound } from './environment';
import { hasDb, query } from './db';
import { sendEmail } from './email';
import { SERVICE_EMAIL } from './constants';
import { SITE_URL } from './site';
import { getSetting, setSetting } from './settings';
import { modelImage, } from './images';
import { setModelPhoto, warmModelPhotos } from './model-photos';
import {
  callConfigured, callBaseUrl, twilioSignatureOk, sayTwiml
} from './import-call';
import { scanIssues, loadSnoozes } from './manager-issues';
import { openingLine, shouldCallNow, toE164, MAX_ATTEMPTS_PER_DAY } from './manager-rules';

export { twilioSignatureOk, sayTwiml, callBaseUrl };

const MODEL = () => process.env.MANAGER_CALL_MODEL || process.env.DISPATCH_CALL_MODEL || 'claude-sonnet-5';

// The ONLY number this will ever ring: the owner's, set by him (2026-11-04).
// Never a parameter from a browser, a request body or a sheet — a call that can
// be pointed at an arbitrary number is a robocaller with our name on it.
export const OWNER_NUMBER = '(647) 643-3035';
export async function managerTarget() {
  const env = toE164(process.env.MANAGER_CALL_TO);
  if (env) return env;
  const saved = toE164(await getSetting('manager_call_to', ''));
  return saved || toE164(OWNER_NUMBER);
}

export { callConfigured };

// ── The webhook's second lock ───────────────────────────────────────────────
export function callToken(callId) {
  const secret = process.env.AUTH_SECRET || process.env.TWILIO_AUTH_TOKEN || 'manager';
  return crypto.createHmac('sha256', secret).update(`manager-call:${callId}`).digest('hex').slice(0, 32);
}
export const callTokenOk = (callId, token) => {
  const want = Buffer.from(callToken(callId));
  const got = Buffer.from(String(token || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

// ── Storage ─────────────────────────────────────────────────────────────────
let _schema = null;
export function ensureManagerSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS manager_calls (
        id serial PRIMARY KEY, call_sid text, to_number text,
        trigger text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'placed',
        issues jsonb NOT NULL DEFAULT '[]'::jsonb, log jsonb NOT NULL DEFAULT '[]'::jsonb,
        actions jsonb NOT NULL DEFAULT '[]'::jsonb, pending jsonb, turns int NOT NULL DEFAULT 0,
        started_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz, ended_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_manager_calls_started ON manager_calls(started_at DESC);
      CREATE TABLE IF NOT EXISTS manager_notes (
        id serial PRIMARY KEY, body text NOT NULL, call_id int,
        created_at timestamptz NOT NULL DEFAULT now(), done_at timestamptz
      );
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

export async function getCall(id) {
  await ensureManagerSchema();
  const { rows } = await query('SELECT * FROM manager_calls WHERE id = $1', [Number(id)]);
  return rows[0] || null;
}

export async function callsToday() {
  await ensureManagerSchema();
  const { rows } = await query(
    `SELECT id, status, trigger, started_at FROM manager_calls
      WHERE (started_at AT TIME ZONE 'America/Toronto')::date = (now() AT TIME ZONE 'America/Toronto')::date
      ORDER BY id`);
  return rows;
}

export async function recentCalls(limit = 10) {
  await ensureManagerSchema();
  const { rows } = await query(
    `SELECT id, trigger, status, turns, started_at, answered_at, ended_at, actions
       FROM manager_calls ORDER BY id DESC LIMIT $1`, [limit]);
  return rows;
}

export async function openNotes() {
  await ensureManagerSchema();
  const { rows } = await query('SELECT id, body, created_at FROM manager_notes WHERE done_at IS NULL ORDER BY id');
  return rows;
}

// ── The tools ───────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'issue_details',
    description: 'Read the full detail of one issue from the scan — e.g. the list of models missing a photo. Use it when he asks "which ones" or wants more than the one-line summary.',
    input_schema: { type: 'object', properties: { key: { type: 'string', description: 'The issue key from the list.' } }, required: ['key'] }
  },
  {
    name: 'set_photo_from_model',
    description: 'Give a model that has NO stock photo the same stock photo another model already has (e.g. a sibling in the same product family). A catalogue write: it is proposed first and only runs once he has said yes to the read-back.',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'The model number with no photo, exactly as the issue detail spells it.' },
        copy_from: { type: 'string', description: 'A model number that already has the photo to use.' }
      },
      required: ['model', 'copy_from']
    }
  },
  {
    name: 'run_inventory_sync',
    description: 'Refresh the website\'s stock from the master tracker — the same as pressing Sync inventory. Proposed first, runs only after a yes.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'snooze_issue',
    description: 'Stop mentioning one issue for a number of days. Use when he says leave it, he knows about it, or ask me later.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' }, days: { type: 'integer', description: '1 to 30. Default 3.' } },
      required: ['key']
    }
  },
  {
    name: 'add_note',
    description: 'Write down something he wants kept or looked into later. It is read back to him on the next call and shown on the Manager page.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  },
  {
    name: 'email_details',
    description: 'Email him the full list of issues with links to fix each one. Use for anything that needs typing or a screen — a photo link, a long list of model numbers.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'end_call',
    description: 'Say goodbye and hang up. Use when he says that is all, or asks you to stop.',
    input_schema: { type: 'object', properties: {} }
  }
];

const WRITES = new Set(['set_photo_from_model', 'run_inventory_sync']);
const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
const abs = (u) => (String(u).startsWith('/') ? `${SITE_URL}${u}` : String(u));

async function recordAction(callId, entry) {
  await query(
    `UPDATE manager_calls SET actions = actions || $2::jsonb WHERE id = $1`,
    [Number(callId), JSON.stringify([{ at: new Date().toISOString(), ...entry }])]);
}

// What he is told to confirm — built here, not by the model, so the thing read
// back is exactly the thing that will run.
function readBack(name, input) {
  if (name === 'set_photo_from_model') return `use the photo for ${input.copy_from} as the stock photo for ${input.model}`;
  if (name === 'run_inventory_sync') return 'refresh the website stock from the tracker';
  return name;
}

export async function runTool(callId, name, input = {}, { turn } = {}) {
  const call = await getCall(callId);
  if (!call) return { error: 'This call is no longer on record.' };
  const snap = call.issues?.list || [];

  // Writes: propose, then run only on a later turn with identical arguments.
  if (WRITES.has(name)) {
    const p = call.pending;
    const confirmed = p && p.tool === name && same(p.args, input) && Number(p.turn) < Number(turn);
    if (!confirmed) {
      await query('UPDATE manager_calls SET pending = $2::jsonb WHERE id = $1',
        [Number(callId), JSON.stringify({ tool: name, args: input, turn })]);
      return { needs_confirmation: true, read_back: readBack(name, input),
        instruction: 'Read that back to him and ask for a yes. Do not call this tool again until he has answered.' };
    }
    await query('UPDATE manager_calls SET pending = NULL WHERE id = $1', [Number(callId)]);
  }

  switch (name) {
    case 'issue_details': {
      const i = snap.find((x) => x.key === input.key);
      if (!i) return { error: `There is no issue called "${input.key}". The keys are: ${snap.map((x) => x.key).join(', ')}.` };
      return { title: i.title, severity: i.severity, detail: i.detail, link: i.link ? abs(i.link) : null };
    }
    case 'set_photo_from_model': {
      const model = String(input.model || '').trim();
      const from = String(input.copy_from || '').trim();
      if (!model || !from) return { error: 'I need both model numbers.' };
      await warmModelPhotos(true);
      const src = modelImage(from);
      if (!src) return { error: `${from} has no photo to copy, so I have changed nothing.` };
      if (modelImage(model)) return { error: `${model} already has a photo, so I have left it alone.` };
      const r = await setModelPhoto(model, { url: abs(src) }, { createdBy: 'voice-manager@bargainbay.ca' });
      await recordAction(callId, { tool: name, model, copy_from: from, url: r.url });
      return { ok: true, said: `${model} now uses the photo from ${from}` };
    }
    case 'run_inventory_sync': {
      const { syncInventoryFromTracker } = await import('./catalog-sync');
      const r = await syncInventoryFromTracker();
      const skipped = r.report?.skippedNoPrice || 0;
      await recordAction(callId, { tool: name, upserted: r.upserted ?? null, skippedNoPrice: skipped });
      return { ok: true, said: `the stock was refreshed${skipped ? `, but ${skipped} tested units have no price so they are not showing` : ''}`, report: { skippedNoPrice: skipped, noStockPhoto: r.report?.noStockPhoto?.length || 0 } };
    }
    case 'snooze_issue': {
      const i = snap.find((x) => x.key === input.key);
      if (!i) return { error: `There is no issue called "${input.key}".` };
      const days = Math.min(30, Math.max(1, Number(input.days) || 3));
      const snoozes = await loadSnoozes();
      snoozes[i.key] = new Date(Date.now() + days * 86400_000).toISOString();
      await setSetting('manager_snoozes', snoozes);
      await recordAction(callId, { tool: name, key: i.key, days });
      return { ok: true, said: `I will not mention that for ${days} ${days === 1 ? 'day' : 'days'}` };
    }
    case 'add_note': {
      const text = String(input.text || '').trim().slice(0, 500);
      if (!text) return { error: 'There was nothing to write down.' };
      await query('INSERT INTO manager_notes (body, call_id) VALUES ($1, $2)', [text, Number(callId)]);
      await recordAction(callId, { tool: name, text });
      return { ok: true, said: 'written down' };
    }
    case 'email_details': {
      const sent = await emailIssues(snap, call.issues?.hidden || 0);
      await recordAction(callId, { tool: name, sent: !!sent });
      return sent ? { ok: true, said: 'I have emailed you the list with links' } : { error: 'The email did not send.' };
    }
    case 'end_call':
      return { ok: true, done: true };
    default:
      return { error: 'Unknown tool.' };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function emailIssues(issues, hidden = 0) {
  const rows = issues.map((i) => `<li><b>${esc(i.severity.toUpperCase())}</b> — ${esc(i.title)}`
    + `${i.link ? ` — <a href="${esc(abs(i.link))}">fix it</a>` : ''}`
    + `${i.detail && i.detail !== i.title ? `<br><span style="color:#555;white-space:pre-line">${esc(i.detail)}</span>` : ''}</li>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px"><p>Your Bargain Bay manager's list${hidden ? ` (${hidden} snoozed)` : ''}:</p><ul>${rows || '<li>Nothing needs you.</li>'}</ul>`
    + `<p style="color:#666;font-size:12px">Sent because you asked on a call. Everything here is also on <a href="${SITE_URL}/admin/manager">the Manager page</a>.</p></div>`;
  const r = await sendEmail({ to: SERVICE_EMAIL, subject: `Manager list: ${issues.length} item${issues.length === 1 ? '' : 's'}`, html }).catch(() => null);
  return !!(r && r.ok !== false);
}

// ── One turn ────────────────────────────────────────────────────────────────

const SYSTEM = (snap, today, notes) => `
You are the Bargain Bay manager, on a PHONE CALL with the owner. You rang him
because you found things wrong with the business. Speak in short plain sentences:
no lists, no markdown, no spelling things out unless asked. One thing at a time,
and wait for his answer. Keep every reply under about forty words.

Today is ${today} (Toronto).

WHAT YOU FOUND (most important first; the key is what you use in tools):
${snap.length ? snap.map((i, n) => `${n + 1}. [${i.key}] (${i.severity}) ${i.title}`).join('\n') : '- nothing'}
${notes.length ? `\nNOTES HE ASKED YOU TO KEEP:\n${notes.map((n) => `- ${n.body}`).join('\n')}` : ''}

How to run the call:
- He may want to go through them in order, jump to one, or ask what else you
  could work on. Follow him. After each one, ask what he wants done.
- You can only change a few things (the tools). A photo can only be copied from a
  model that already has one: ask him which model it resembles. If it needs a link
  or typing, offer to email the details with email_details instead.
- A write tool only proposes. Read the proposal back in your own words, ask for a
  yes, and only then call it again with the same arguments. Never assume a yes.
- If he says a model number, read it back letter by letter before you use it: a
  misheard model is a wrong picture on a real product.
- You cannot touch money, invoices, orders, customers, prices or drivers. If he
  asks, say that needs him on the screen, and offer to add a note.
- Do not invent facts. If you do not know, say so and offer to note it.
- When he is finished, call end_call.
`.trim();

export async function managerTurn(callId, speech) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { say: 'I am not set up to talk right now. Nothing was changed.', done: true };
  const call = await getCall(callId);
  if (!call) return { say: 'This call is no longer on record. Nothing was changed.', done: true };

  const turn = (call.turns || 0) + 1;
  await query('UPDATE manager_calls SET turns = $2 WHERE id = $1', [Number(callId), turn]);

  const snap = call.issues?.list || [];
  const notes = await openNotes();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const messages = [...(call.log || []), { role: 'user', content: String(speech || '').slice(0, 600) || '(they said nothing)' }];

  let say = '';
  let done = false;
  // Three passes: enough for "read me the photos one, copy it from that, yes".
  // A loop that can run forever is a phone call that goes silent while Twilio's
  // webhook times out.
  for (let pass = 0; pass < 3; pass++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 700, tools: TOOLS, system: SYSTEM(snap, today, notes), messages })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('manager call model', r.status, data?.error?.message);
      return { say: 'Something went wrong at my end. Nothing was changed. The list is on the Manager page. Goodbye.', done: true };
    }
    const content = data.content || [];
    say = content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
    const calls = content.filter((c) => c.type === 'tool_use');
    if (!calls.length) break;

    messages.push({ role: 'assistant', content });
    const results = [];
    for (const c of calls) {
      let out;
      try { out = await runTool(callId, c.name, c.input || {}, { turn }); }
      catch (e) {
        console.error('manager tool failed', c.name, e?.message || e);
        out = { error: `That did not work: ${e?.message || 'unknown error'}. Nothing was changed.` };
      }
      if (out?.done) done = true;
      results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
    if (done) {
      const closing = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL(), max_tokens: 200,
          system: SYSTEM(snap, today, notes) + '\n\nThe call is finishing. Say in one short sentence what you did on this call (or that you changed nothing), then goodbye.',
          messages
        })
      }).then((x) => x.json()).catch(() => null);
      const tail = (closing?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
      say = tail || say || 'Okay. Goodbye.';
      break;
    }
  }

  // The transcript is kept SHORT on purpose: it is context for the next turn, not
  // a recording. What was DONE is in `actions`.
  await query('UPDATE manager_calls SET log = $2::jsonb WHERE id = $1',
    [Number(callId), JSON.stringify([...messages.slice(-14), { role: 'assistant', content: say || 'Sorry, I did not catch that.' }])]);
  return { say: say || 'Sorry, I did not catch that. Could you say it again?', done };
}

export async function markAnswered(callId) {
  await query(`UPDATE manager_calls SET status = 'answered', answered_at = COALESCE(answered_at, now()) WHERE id = $1 AND status = 'placed'`, [Number(callId)]);
}
export async function markEnded(callId, status = 'done') {
  await query(`UPDATE manager_calls SET status = $2, ended_at = now() WHERE id = $1`, [Number(callId), status]);
}

export async function greeting(callId) {
  const call = await getCall(callId);
  if (!call) return null;
  const notes = await openNotes();
  return openingLine(call.issues?.list || [], { hidden: call.issues?.hidden || 0, notes: notes.length });
}

// ── Placing the call ────────────────────────────────────────────────────────
export async function startManagerCall({ trigger = 'manual', scan = null } = {}) {
  if (!callConfigured()) return { ok: false, reason: 'Calling is not set up (Twilio and ANTHROPIC_API_KEY).' };
  const to = await managerTarget();
  if (!to) return { ok: false, reason: 'No number to ring.' };

  // An outbound call RINGS A REAL PERSON: never from a non-production deployment,
  // and never redirected — there is no safe number to ring instead.
  const gate = outbound('voice');
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  await ensureManagerSchema();
  const found = scan || await scanIssues();
  const { rows: [row] } = await query(
    `INSERT INTO manager_calls (to_number, trigger, issues) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [to, trigger, JSON.stringify({ list: found.issues, hidden: found.hidden?.length || 0 })]);

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const url = `${callBaseUrl()}/api/manager/call?callId=${row.id}&t=${callToken(row.id)}`;
  const params = new URLSearchParams({
    To: to, From: process.env.TWILIO_FROM, Url: url, Method: 'POST',
    // A voicemail of a status report helps nobody, and the list is on the page.
    MachineDetection: 'Enable', Timeout: '25'
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await markEnded(row.id, 'failed');
    console.error('manager call failed', res.status, data?.message);
    return { ok: false, reason: data?.message || `Could not place the call (${res.status}).` };
  }
  await query('UPDATE manager_calls SET call_sid = $2 WHERE id = $1', [row.id, data.sid]);
  return { ok: true, callId: row.id, to, issues: found.issues.length };
}

// The scheduled pass: scan, decide, and ring only when it is worth it.
export async function runManagerPass({ dry = false } = {}) {
  const scan = await scanIssues();
  const today = await callsToday();
  const decision = shouldCallNow({ issues: scan.issues, today });
  const summary = { issues: scan.issues.length, hidden: scan.hidden.length, attemptsToday: today.length, maxAttempts: MAX_ATTEMPTS_PER_DAY, ...decision };
  if (!decision.call || dry) return { ok: true, called: false, ...summary };
  const r = await startManagerCall({ trigger: 'cron', scan });
  return { ok: r.ok, called: r.ok, ...summary, ...(r.ok ? { callId: r.callId } : { reason: r.reason }) };
}

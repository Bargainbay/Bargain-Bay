// The import, read down the phone.
//
// A spreadsheet arrives the night before a run and somebody has to sit at a
// screen and check it. The owner is not at a screen — he is in the warehouse or
// in a van — so the review either happens late or happens badly, and the stops
// that needed a second look are the ones that go out wrong.
//
// So the batch rings him. It reads what it has, names only the rows that need
// an answer, takes the answers as speech, and writes nothing to the board until
// he says go. Every tool below acts on ONE staged batch and nothing else: this
// agent can correct an address and file a sheet under a client, and it cannot
// touch a stop that is already on the board, an invoice, a driver or an order.
//
// Reuses what is already here rather than standing anything up: Twilio's REST
// API the way `lib/sms.js` calls it, ElevenLabs through `lib/voice.js`, and
// `lib/sarah-audio.js` for the public mp3 URL Twilio has to be able to fetch.
import crypto from 'crypto';
import { hasDb, query } from './db';
import { synthesizeSpeech } from './voice';
import { storeAudio } from './sarah-audio';
import { listClients } from './jobs';
import { matchClient } from './client-match';
import {
  resolveBatch, patchBatch, setBatchClient, approveBatch, cancelBatch,
  addClientAlias, openQuestions, ensureImportSchema
} from './import-batches';
import { getSetting } from './settings';
import { brandFor } from './brands';

const MODEL = () => process.env.DISPATCH_CALL_MODEL || 'claude-sonnet-5';

// The RS host, because that is where dispatch lives and where the proxy lets
// /api through. Twilio must be able to reach it and it must match byte for byte
// what we sign — so it is built once, here, and never from the request.
//
// Taken from the BRAND rather than defined again: `RS_SITE_URL` is unset in
// production, and a private fallback through `SITE_URL` would have pointed the
// webhook and the spoken audio at bargainbay.ca — the storefront — for a call
// that is entirely RS Solutions. Same rule as an RS invoice's links.
export const callBaseUrl = () => brandFor('rs_solutions').url();

export function callConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    && process.env.TWILIO_FROM && process.env.ANTHROPIC_API_KEY);
}

// Who it is allowed to ring. Deliberately NOT a parameter from the browser and
// never a number off a sheet: a review call that can be pointed at an arbitrary
// number is a robocaller with our name on it.
export async function callTarget() {
  const env = process.env.DISPATCH_CALL_TO;
  if (env) return env.trim();
  const saved = await getSetting('dispatch_call_to', '');
  return String(saved || '').trim() || null;
}

// A second lock on the webhook, independent of Twilio's own signature: the URL
// carries a token only this app can mint. Twilio's signature proves the request
// came from Twilio; this proves it is about a batch we actually rang out on.
export function batchToken(batchId) {
  const secret = process.env.AUTH_SECRET || process.env.TWILIO_AUTH_TOKEN || 'dispatch';
  return crypto.createHmac('sha256', secret).update(`import-call:${batchId}`).digest('hex').slice(0, 32);
}
export const batchTokenOk = (batchId, token) => {
  const want = Buffer.from(batchToken(batchId));
  const got = Buffer.from(String(token || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

// Twilio signs the full URL plus every POST parameter, sorted by name and
// concatenated as key+value. Anything that fails this is not from Twilio.
export function twilioSignatureOk(url, params, signature) {
  const auth = process.env.TWILIO_AUTH_TOKEN;
  if (!auth) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const want = crypto.createHmac('sha1', auth).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(want);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Call state ──────────────────────────────────────────────────────────────
let _callSchema = null;
function ensureCallSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_callSchema) {
    _callSchema = ensureImportSchema().then(() => query(`
      ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS call_sid text;
      ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS call_to text;
      ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS call_log jsonb NOT NULL DEFAULT '[]'::jsonb;
    `));
  }
  return _callSchema;
}

async function readLog(batchId) {
  await ensureCallSchema();
  const { rows } = await query('SELECT call_log FROM import_batches WHERE id = $1', [Number(batchId)]);
  return rows[0]?.call_log || [];
}
async function writeLog(batchId, log) {
  // The transcript is kept SHORT on purpose: it is context for the next turn,
  // not a recording. The batch's own state is the record of what was decided.
  await query('UPDATE import_batches SET call_log = $2 WHERE id = $1',
    [Number(batchId), JSON.stringify(log.slice(-16))]);
}

// ── What it says first ──────────────────────────────────────────────────────

// The opening line, built from the batch rather than asked of the model — the
// summary is arithmetic and a model reading it back is a chance to get it
// wrong. It also sets the shape of the call: what is here, what needs you.
export function openingLine(batch, questions) {
  const s = batch.summary;
  const who = batch.clientName ? `from ${batch.clientName}` : 'with no client set on it';
  const day = s.days.length === 1 ? ` for ${spokenDate(s.days[0])}` : (s.days.length > 1 ? ` across ${s.days.length} days` : ' with no day set');
  const bits = [`Sheet ${who}, ${s.rows} ${s.rows === 1 ? 'stop' : 'stops'}${day}.`];

  const blockers = questions.filter((q) => q.blocking).length;
  const asks = questions.length;
  if (!asks) {
    bits.push(`All ${s.ready} look fine. Say "add them" and they go on the board, or "read them to me" first.`);
  } else {
    bits.push(`${s.ready} ${s.ready === 1 ? 'is' : 'are'} ready.`);
    bits.push(blockers
      ? `${asks === 1 ? 'One thing needs' : `${asks} things need`} you, and ${blockers === 1 ? 'one of them is keeping a stop' : `${blockers} of them are keeping stops`} off the board.`
      : `${asks === 1 ? 'One thing needs' : `${asks} things need`} you.`);
    bits.push('Shall I go through them?');
  }
  return bits.join(' ');
}

const spokenDate = (iso) => {
  if (!iso) return 'no day';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Toronto'
    });
  } catch { return iso; }
};

// ── The tools ───────────────────────────────────────────────────────────────
// Each one is a thin wrapper over the same functions the SCREEN calls. There is
// no second way to change a batch, so the phone and the browser can never
// disagree about what row 4 says.
const TOOLS = [
  {
    name: 'read_stops',
    description: 'Read back stops from the sheet. Use it when asked what is on the sheet, or to describe the rows that need an answer. Returns customer, address, day, window, what is on it, and any problems.',
    input_schema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'integer' }, description: 'Specific row numbers as the caller says them (1 = the first stop). Leave empty for the ones that need an answer.' },
        all: { type: 'boolean', description: 'True to read every stop, not just the ones with problems.' }
      }
    }
  },
  {
    name: 'set_client',
    description: 'Set which client company the sheet is for. Applies to every stop on it. Use when the caller names the company the whole sheet belongs to.',
    input_schema: {
      type: 'object',
      properties: { client: { type: 'string', description: 'The company name as the caller said it, e.g. "Canadian Discount Appliances" or "CDA".' } },
      required: ['client']
    }
  },
  {
    name: 'set_day',
    description: 'Set the delivery day for stops that have no date of their own.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD. Work out "tomorrow" from the date given in the system prompt.' } },
      required: ['date']
    }
  },
  {
    name: 'fix_stop',
    description: 'Correct one stop. Only pass the fields the caller actually gave you — anything left out is left alone.',
    input_schema: {
      type: 'object',
      properties: {
        row: { type: 'integer', description: 'Row number as spoken, 1 = the first stop.' },
        address: { type: 'string' }, city: { type: 'string' }, postal: { type: 'string' },
        client: { type: 'string', description: 'The company this one stop is for.' },
        date: { type: 'string', description: 'YYYY-MM-DD.' }
      },
      required: ['row']
    }
  },
  {
    name: 'drop_stop',
    description: 'Leave one stop off. It stays on the sheet, struck through, and is not put on the board.',
    input_schema: {
      type: 'object',
      properties: { row: { type: 'integer' }, keep: { type: 'boolean', description: 'True to put a dropped stop back.' } },
      required: ['row']
    }
  },
  {
    name: 'remember_alias',
    description: 'Remember that a name on the sheet means one of our clients — e.g. the sheet says "CDA" and that is Canadian Discount Appliances. Only after the caller has confirmed it. It is used on every future sheet.',
    input_schema: {
      type: 'object',
      properties: {
        as_written: { type: 'string', description: 'Exactly what the sheet says.' },
        client: { type: 'string', description: 'Our client it means.' }
      },
      required: ['as_written', 'client']
    }
  },
  {
    name: 'approve',
    description: 'Put the ready stops on the board. This is the only thing that writes to the board — use it ONLY when the caller has clearly said to go ahead.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'leave_it',
    description: 'End the call without adding anything. The sheet stays waiting to be checked on the Import tab. Use when the caller wants to look at it themselves or asks to stop.',
    input_schema: {
      type: 'object',
      properties: { discard: { type: 'boolean', description: 'True only if the caller said to throw the sheet away entirely.' } }
    }
  }
];

async function runTool(batchId, name, input, by) {
  const batch = await resolveBatch(batchId);
  if (!batch) return { error: 'That sheet is no longer here.' };
  const clients = batch.clients || [];

  // The caller says a company name out loud; a speech transcript is never going
  // to match the clients table exactly. Same matcher the importer uses.
  const resolveClient = async (said) => {
    const m = matchClient(said, clients, {});
    if (!m.clientId) return { error: `I don't have a client called "${said}". The ones I have are ${clients.map((c) => c.name).join(', ')}.` };
    return { id: m.clientId, name: m.client.name, confident: m.confident, why: m.why };
  };

  const rowOf = (n) => batch.stops.find((s) => s.index === Number(n) - 1);

  switch (name) {
    case 'read_stops': {
      const wanted = input.all
        ? batch.stops
        : (input.rows?.length
            ? input.rows.map(rowOf).filter(Boolean)
            : batch.stops.filter((s) => !s.dropped && s.needsReview));
      return {
        stops: wanted.slice(0, 25).map((s) => ({
          row: s.index + 1,
          customer: s.job.customerName || null,
          address: [s.job.address, s.job.city].filter(Boolean).join(', ') || null,
          client: clients.find((c) => c.id === s.job.clientId)?.name || null,
          sheetSays: s.sheetClient || null,
          day: s.job.jobDate || null,
          window: s.job.windowStart ? `${s.job.windowStart}–${s.job.windowEnd || '?'}` : 'any time',
          items: s.job.items.map((i) => i.description).join('; ') || null,
          dropped: s.dropped || undefined,
          problems: s.problems.filter((p) => !p.info).map((p) => p.text)
        })),
        more: Math.max(0, wanted.length - 25)
      };
    }
    case 'set_client': {
      const c = await resolveClient(input.client);
      if (c.error) return c;
      await setBatchClient(batchId, c.id, { everyRow: true });
      return { ok: true, said: `every stop is now ${c.name}` };
    }
    case 'set_day': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))) return { error: 'I need that as a real date.' };
      await patchBatch(batchId, { jobDate: input.date });
      return { ok: true, said: `the day is ${spokenDate(input.date)}` };
    }
    case 'fix_stop': {
      const s = rowOf(input.row);
      if (!s) return { error: `There is no row ${input.row} — the sheet has ${batch.stops.length}.` };
      const fields = {};
      if (input.address) fields.address = String(input.address).trim();
      if (input.city) fields.city = String(input.city).trim();
      if (input.postal) fields.postal = String(input.postal).trim();
      if (input.date) fields.jobDate = String(input.date).trim();
      if (input.client) {
        const c = await resolveClient(input.client);
        if (c.error) return c;
        fields.clientId = c.id;
      }
      if (!Object.keys(fields).length) return { error: 'Nothing was given to change on that stop.' };
      await patchBatch(batchId, { rowOverrides: { [s.index]: fields } });
      return { ok: true, said: `row ${input.row} updated` };
    }
    case 'drop_stop': {
      const s = rowOf(input.row);
      if (!s) return { error: `There is no row ${input.row}.` };
      await patchBatch(batchId, { rowOverrides: { [s.index]: { drop: input.keep !== true } } });
      return { ok: true, said: input.keep === true ? `row ${input.row} is back on` : `row ${input.row} will be left off` };
    }
    case 'remember_alias': {
      const c = await resolveClient(input.client);
      if (c.error) return c;
      await addClientAlias(c.id, input.as_written, by);
      return { ok: true, said: `“${input.as_written}” will mean ${c.name} from now on` };
    }
    case 'approve': {
      const out = await approveBatch(batchId, by);
      return { ok: true, added: out.added, failed: out.failed?.length || 0, done: true };
    }
    case 'leave_it': {
      if (input.discard) await cancelBatch(batchId, by);
      return { ok: true, discarded: !!input.discard, done: true };
    }
    default:
      return { error: 'Unknown tool.' };
  }
}

// ── One turn ────────────────────────────────────────────────────────────────

const SYSTEM = (batch, questions, today) => `
You are the dispatch office at RS Solutions, ringing the owner to check a
delivery sheet a client has sent in before it goes on the board. You are on a
PHONE CALL: speak in short plain sentences, no lists, no markdown, no spelling
things out unless asked. One question at a time, and wait for the answer.

Today is ${today} (Toronto). "Tomorrow" means the day after that.

THE SHEET (${batch.batchNumber}, from ${batch.sourceName || 'pasted rows'}):
${batch.summary.rows} rows, ${batch.summary.ready} ready, ${batch.summary.blocked} that cannot be added, ${batch.summary.dropped} already left off.
Client: ${batch.clientName || 'not set'}. Day: ${batch.summary.days.join(', ') || 'not set'}.
Our clients are: ${(batch.clients || []).map((c) => c.name).join(', ') || 'none on file'}.

WHAT STILL NEEDS AN ANSWER:
${questions.length ? questions.slice(0, 20).map((q) => `- ${q.text}`).join('\n') : '- nothing'}

How to run the call:
- Work through the things that need an answer, most important first: a stop with
  no address cannot go out at all.
- When he gives you an address or a company, read it back before you write it.
  A misheard street number is a van at the wrong door.
- If he says a company you do not have, say the names you DO have. Never invent
  a client and never guess between two that sound alike.
- If the sheet writes a client one way and he confirms which of ours it is,
  offer to remember it so the next sheet knows.
- NOTHING goes on the board until he says so. Call approve only on a clear yes.
- If he wants to deal with it himself, use leave_it and say it is waiting on the
  Import tab. Do not push.
- Keep every reply under about forty words.
`.trim();

// Returns { say, done }. One turn: the caller's speech in, spoken reply out,
// with any tool calls carried out in between.
export async function importCallTurn(batchId, speech, by) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { say: 'The office system is not set up for this call. Nothing was changed.', done: true };

  const batch = await resolveBatch(batchId);
  if (!batch) return { say: 'That sheet is no longer here. Nothing was changed.', done: true };
  if (batch.status !== 'draft') {
    return { say: `That sheet was already ${batch.status}. Nothing was changed.`, done: true };
  }

  const log = await readLog(batchId);
  const messages = [...log, { role: 'user', content: String(speech || '').slice(0, 600) || '(they said nothing)' }];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const questions = openQuestions(batch);

  let say = '';
  let done = false;

  // Three passes is enough for "read me the bad ones, fix that one, now add
  // them". A loop that can run forever is a phone call that goes silent while
  // Twilio's webhook times out.
  for (let pass = 0; pass < 3; pass++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(), max_tokens: 700, tools: TOOLS,
        system: SYSTEM(batch, questions, today),
        messages
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('import call model', r.status, data?.error?.message);
      return { say: 'Something went wrong at this end. The sheet is untouched and still waiting on the Import tab.', done: true };
    }

    const content = data.content || [];
    say = content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
    const calls = content.filter((c) => c.type === 'tool_use');
    if (!calls.length) break;

    messages.push({ role: 'assistant', content });
    const results = [];
    for (const c of calls) {
      const out = await runTool(batchId, c.name, c.input || {}, by);
      if (out?.done) done = true;
      results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
    if (done) {
      // One more pass so it can say what it did, then stop — but never another
      // tool call after the board has been written to.
      const closing = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL(), max_tokens: 200,
          system: SYSTEM(batch, questions, today) + '\n\nThe call is finishing. Say in one short sentence what was done, then goodbye.',
          messages
        })
      }).then((x) => x.json()).catch(() => null);
      const tail = (closing?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
      say = tail || say || 'Done. Goodbye.';
      break;
    }
  }

  await writeLog(batchId, [
    ...messages.filter((m) => typeof m.content === 'string' || Array.isArray(m.content)).slice(-14),
    { role: 'assistant', content: say || 'Sorry, I did not catch that.' }
  ]);

  return { say: say || 'Sorry, I did not catch that. Could you say it again?', done };
}

// ── Speaking ────────────────────────────────────────────────────────────────

// ElevenLabs, served from our own public route because Twilio has to fetch the
// audio anonymously and the Blob store is private. Falls back to Twilio's own
// voice rather than to silence: a call that says nothing is worse than a call
// that sounds robotic.
export async function sayTwiml(text, { gatherTo, hangUp = false } = {}) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  let voice = `<Say voice="Polly.Matthew-Neural">${esc(text)}</Say>`;
  try {
    const mp3 = await synthesizeSpeech(text, { format: 'mp3' });
    const id = mp3 ? await storeAudio(mp3) : null;
    if (id) voice = `<Play>${esc(`${callBaseUrl()}/api/sarah/voice/${id}.mp3`)}</Play>`;
  } catch (e) {
    console.error('import call tts failed', e?.message || e);
  }

  // The Gather's action URL already carries a query string, so the fall-through
  // has to JOIN onto it — appending "?silent=1" produced a second "?" and a URL
  // Twilio would post to with the flag as part of the token.
  const silentTo = gatherTo ? `${gatherTo}${gatherTo.includes('?') ? '&' : '?'}silent=1` : '';

  const body = hangUp
    ? `${voice}<Hangup/>`
    : `<Gather input="speech" speechTimeout="auto" language="en-CA" action="${esc(gatherTo)}" method="POST">${voice}</Gather>`
      + `<Redirect method="POST">${esc(silentTo)}</Redirect>`;

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

// ── Placing the call ────────────────────────────────────────────────────────
export async function startImportCall(batchId, { by } = {}) {
  if (!callConfigured()) throw new Error('Calling is not set up (Twilio and ANTHROPIC_API_KEY).');
  await ensureCallSchema();

  const batch = await resolveBatch(batchId);
  if (!batch) throw new Error('That import is no longer here.');
  if (batch.status !== 'draft') throw new Error(`That import was already ${batch.status}.`);

  const to = await callTarget();
  if (!to) throw new Error('No number to ring — set the dispatch call number first.');

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const url = `${callBaseUrl()}/api/dispatch/import-call?batchId=${batch.id}&t=${batchToken(batch.id)}`;

  // A fresh call starts a fresh conversation — an old transcript would have the
  // model answering a question nobody just asked.
  await query('UPDATE import_batches SET call_log = \'[]\'::jsonb, call_to = $2 WHERE id = $1', [batch.id, to]);

  const params = new URLSearchParams({
    To: to, From: process.env.TWILIO_FROM, Url: url, Method: 'POST',
    // If it rings out, leave it: a voicemail of a delivery sheet helps nobody,
    // and the batch is still sitting on the Import tab either way.
    MachineDetection: 'Enable', Timeout: '25'
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('twilio call failed', res.status, data?.message);
    throw new Error(data?.message || `Could not place the call (${res.status}).`);
  }
  await query('UPDATE import_batches SET call_sid = $2 WHERE id = $1', [batch.id, data.sid]);
  return { ok: true, to, callSid: data.sid };
}

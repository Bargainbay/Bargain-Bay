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
import { planStaleClose, closeStaleStops, backupNow, cdaStatus, queueDevRequest } from './manager-fixes';
import { openingLine, shouldCallNow, toE164, MAX_ATTEMPTS_PER_DAY } from './manager-rules';
import { DEPTS, deptKey, toolsFor, isGated, isOwnerOnly, tierOf, overApproval, OWNER_APPROVAL_OVER, callerFor } from './manager-policy';
import { TOOLS as MONEY_TOOLS, NEW_TOOL_NAMES, runNewTool, readBackNew, amountOf } from './manager-tools';
import { notifyDone } from './manager-report';

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
      ALTER TABLE manager_calls ADD COLUMN IF NOT EXISTS dept text NOT NULL DEFAULT 'gm';
      ALTER TABLE manager_calls ADD COLUMN IF NOT EXISTS caller text;
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
    name: 'stale_stops_preview',
    description: 'Look at the delivery stops from earlier days that were never closed, and say what closing them would do: how many would be marked done (they have a signature, photos or a clock-in), how many cancelled (no trace they happened), and any left alone (money reported or still owing). Changes nothing.',
    input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['auto', 'cancel_all'] } } }
  },
  {
    name: 'close_stale_stops',
    description: 'Close the old unclosed delivery stops. mode "auto" (default) marks the ones with evidence done and cancels the rest; "cancel_all" cancels every one. Stops with money reported or a balance owing are always left alone. Proposed first; runs only after his yes.',
    input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['auto', 'cancel_all'] } } }
  },
  {
    name: 'run_backup_now',
    description: 'Run the off-site backup right now and report exactly why it failed, if it does. It only copies files to the backup folder. Proposed first; runs only after his yes.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'cda_status',
    description: 'Check whether the CDA workbook watcher can read the workbook, and say precisely what is missing if not. Changes nothing.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'request_code_change',
    description: 'Something that needs a code change or a setting only a developer can make (a new feature, a bug on the site, a secret to add). Writes it to the developer queue shown on the Manager page. Use when no other tool can do what he asks.',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: 'What he wants, in a sentence or two, with the issue key if there is one.' } }, required: ['text'] }
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
    name: 'business_snapshot',
    description: 'How the business is doing right now: today\'s orders and pre-tax revenue, today\'s delivery stops (done, failed, with no driver), overdue invoices, and live stock. Use for "how are we doing" or "how is today going". Counts only; no costs.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'list_drivers',
    description: 'The drivers you can put on a stop, by name.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'assign_stop',
    description: 'Put a named driver on a delivery stop (and optionally move it to a day). Does it immediately and tells him after; it is undone on the dispatch board. Use the stop number from the scan, e.g. RS-1023.',
    input_schema: {
      type: 'object',
      properties: {
        job_number: { type: 'string' }, driver_name: { type: 'string' },
        job_date: { type: 'string', description: 'Optional YYYY-MM-DD to move the stop to.' }
      },
      required: ['job_number', 'driver_name']
    }
  },
  {
    name: 'add_followup',
    description: 'Raise a follow-up task against a customer (found by name or email) so somebody on the sales team rings them. Does it immediately. It never contacts the customer.',
    input_schema: {
      type: 'object',
      properties: { customer: { type: 'string' }, title: { type: 'string' }, due_on: { type: 'string', description: 'Optional YYYY-MM-DD. Default tomorrow.' } },
      required: ['customer', 'title']
    }
  },
  {
    name: 'pull_orders',
    description: 'Put confirmed delivery orders that have no stop onto the dispatch board. Does it immediately.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'what_i_did',
    description: 'List what you did on your own and for him recently, so he can hear it or ask you to undo something by saying where to look.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'next_overdue_invoice',
    description: 'The next overdue invoice to go through, oldest first, skipping any already answered in the last two days. Returns who, how much is owing, when it was due, how late, what it was for, and where you are in the list ("3 of 18"). Use this to RUN the list yourself: read it out and ask if it is still open.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'find_overdue_invoice',
    description: 'Look up an overdue invoice by a name, part of a name, an email or an invoice number. It tolerates speech mishearing ("Roger" will find "Rogers"). Use it whenever he names someone you have not got in front of you, BEFORE you say there is none.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'resolve_invoice',
    description: 'Record his answer on one overdue invoice. outcome "paid" records the payment dated paid_on (YYYY-MM-DD, never in the future) for the full balance unless amount is given; it adjusts the payment ledger and the cash books for that date, does NOT count toward today\'s sales, and sends the customer NOTHING. outcome "still_owing" keeps it open and raises a follow-up for the sales team (optional promised_on). outcome "skip" moves on. Does it immediately; say what you did in one sentence.',
    input_schema: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'The invoice number, e.g. INV-1234.' },
        outcome: { type: 'string', enum: ['paid', 'still_owing', 'skip'] },
        paid_on: { type: 'string', description: 'YYYY-MM-DD, the day the money actually arrived. Work it out from what he says ("August 20th") in the current year.' },
        method: { type: 'string', enum: ['cash', 'etransfer', 'card', 'cheque', 'other'], description: 'Only if he said how. Otherwise leave it out.' },
        amount: { type: 'number', description: 'Only if it was a part payment.' },
        promised_on: { type: 'string', description: 'YYYY-MM-DD if he gives a date they promised to pay.' },
        note: { type: 'string' }
      },
      required: ['number', 'outcome']
    }
  },
  {
    name: 'end_call',
    description: 'Say goodbye and hang up. Use when he says that is all, or asks you to stop.',
    input_schema: { type: 'object', properties: {} }
  }
];

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
  if (name === 'close_stale_stops') return input.mode === 'cancel_all'
    ? 'cancel every old unclosed delivery stop, except any with money reported or owing'
    : 'close the old unclosed delivery stops: done where there is a signature, photos or a clock-in, cancelled where there is no trace, and leave any with money reported or owing';
  if (name === 'run_backup_now') return 'run the off-site backup now and tell you why it fails';
  if (NEW_TOOL_NAMES.has(name)) return readBackNew(name, input);
  return name;
}

// Every task that finishes is emailed to him as it finishes (owner, 2026-11-17).
export async function runTool(callId, name, input = {}, opts = {}) {
  const out = await runToolInner(callId, name, input, opts);
  if (out?.ok && out.said && name !== 'end_call' && !['add_note', 'snooze_issue', 'email_details', 'switch_department'].includes(name)) {
    const call = await getCall(callId).catch(() => null);
    await notifyDone({ summary: out.said, dept: call?.dept || 'gm', by: call?.caller ? `on ${call.caller}'s instruction` : 'on your instruction' });
  }
  return out;
}

async function runToolInner(callId, name, input = {}, { turn } = {}) {
  const call = await getCall(callId);
  if (!call) return { error: 'This call is no longer on record.' };
  const snap = call.issues?.list || [];

  // Writes: propose, then run only on a later turn with identical arguments.
  if (isGated(name)) {
    // A refund, discount or void is only ever done on HIS instruction, on a call he
    // (or Ravi) is on. A call with no recognised caller cannot do one.
    if (isOwnerOnly(name) && !call.caller) return { error: 'I only do that on the owner\'s instruction, and I do not have a recognised caller on this line. Nothing was changed.' };
    const p = call.pending;
    const confirmed = p && p.tool === name && same(p.args, input) && Number(p.turn) < Number(turn);
    if (!confirmed) {
      await query('UPDATE manager_calls SET pending = $2::jsonb WHERE id = $1',
        [Number(callId), JSON.stringify({ tool: name, args: input, turn })]);
      const big = overApproval(amountOf(name, input));
      return { needs_confirmation: true, read_back: readBack(name, input),
        over_fifty: big,
        instruction: `Read that back to him and ask for a yes${big ? ` and say plainly that it is over ${OWNER_APPROVAL_OVER} dollars` : ''}. Do not call this tool again until he has answered.` };
    }
    await query('UPDATE manager_calls SET pending = NULL WHERE id = $1', [Number(callId)]);
  }

  if (NEW_TOOL_NAMES.has(name)) return runNewTool(name, input, { callId, dept: deptKey(call.dept), turn });

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
    case 'stale_stops_preview': {
      const p = await planStaleClose(input.mode === 'cancel_all' ? 'cancel_all' : 'auto');
      return { total: p.total, would_mark_done: p.done, would_cancel: p.cancel, left_alone: p.skipped.slice(0, 8), left_alone_count: p.skipped.length,
        oldest: p.plan[0]?.s.date || null };
    }
    case 'close_stale_stops': {
      const r = await closeStaleStops({ mode: input.mode === 'cancel_all' ? 'cancel_all' : 'auto' });
      await recordAction(callId, { tool: name, ...r, skipped: r.skipped.length, failed: r.failed.length });
      return { ok: true, said: `${r.done} marked done, ${r.cancelled} cancelled, ${r.skipped.length} left for you${r.failed.length ? `, ${r.failed.length} failed` : ''}`, skipped: r.skipped.slice(0, 8), failed: r.failed.slice(0, 5) };
    }
    case 'run_backup_now': {
      const r = await backupNow();
      await recordAction(callId, { tool: name, ok: r.ok, reason: r.reason });
      return r.ok ? { ok: true, said: r.dormant ? 'the backup is not switched on here' : 'the backup ran fine' } : { ok: false, said: 'the backup failed', reason: r.reason };
    }
    case 'cda_status': {
      const s = await cdaStatus();
      return { connected: s.connected, account: s.account, missing: s.missing, read: s.read };
    }
    case 'request_code_change': {
      const body = await queueDevRequest(input.text);
      await recordAction(callId, { tool: name, text: body });
      return { ok: true, said: 'queued for the developer' };
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
    case 'business_snapshot':
      return await (await import('./manager-actions')).businessSnapshot();
    case 'list_drivers':
      return { drivers: (await (await import('./manager-actions')).listDriverOptions()).map((d) => d.name) };
    case 'assign_stop': {
      const r = await (await import('./manager-actions')).assignStopByName({ jobNumber: input.job_number, driverName: input.driver_name, jobDate: input.job_date });
      if (r.ok) await recordAction(callId, { tool: name, job: input.job_number, driver: input.driver_name });
      return r;
    }
    case 'add_followup': {
      const r = await (await import('./manager-actions')).addFollowUpByName({ customer: input.customer, title: input.title, dueOn: input.due_on });
      if (r.ok) await recordAction(callId, { tool: name, customer: input.customer, title: input.title });
      return r;
    }
    case 'pull_orders': {
      const r = await (await import('./manager-actions')).pullOrders();
      await recordAction(callId, { tool: name, ...r });
      return { ok: true, said: r.imported ? `${r.imported} delivery orders are now on the board` : 'there was nothing to put on the board' , skipped: r.skipped };
    }
    case 'what_i_did': {
      const list = await (await import('./manager-actions')).recentActions(15);
      return { actions: list.map((a) => ({ at: a.at, did: a.summary, by: a.via === 'voice' ? 'on his instruction' : 'on my own' })) };
    }
    case 'next_overdue_invoice':
      return await (await import('./manager-actions')).nextOverdueInvoice();
    case 'find_overdue_invoice':
      return await (await import('./manager-actions')).searchOverdueInvoices(input.query);
    case 'resolve_invoice': {
      const r = await (await import('./manager-actions')).resolveInvoice({
        number: input.number, outcome: input.outcome, paidOn: input.paid_on, method: input.method,
        amount: input.amount, promisedOn: input.promised_on, note: input.note
      });
      if (r.ok) await recordAction(callId, { tool: name, number: input.number, outcome: input.outcome, paid_on: input.paid_on || null });
      return r;
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

const SYSTEM = (snap, today, notes, dept = 'gm', caller = 'the owner') => {
  const d = DEPTS[deptKey(dept)];
  return `
You are the ${d.says} of Bargain Bay and RS Solutions, on a PHONE CALL with ${caller}.
You work for the owner like a general manager reports to a CEO: you run the company
day to day and you tell him what you did. ${dept === 'gm' ? 'The Delivery, Sales and Tech Managers report to you, and you report to him; you can take any hat with switch_department.' : `You are one of the department managers who report to the General Manager, who reports to him. Your focus: ${d.focus}`}
Your focus: ${d.focus}
Speak in short plain sentences: no lists, no markdown, no spelling things out unless asked.
One thing at a time, and wait for his answer. Keep every reply under about forty words.

Today is ${today} (Toronto).

WHAT YOU FOUND (most important first; the key is what you use in tools):
${snap.length ? snap.map((i, n) => `${n + 1}. [${i.key}] (${i.severity}) ${i.title}`).join('\n') : '- nothing'}
${notes.length ? `\nNOTES HE ASKED YOU TO KEEP:\n${notes.map((n) => `- ${n.body}`).join('\n')}` : ''}

How you run it:
- Act like a manager. When he gives you a task, find the facts with your read tools, do it, and tell him in one sentence. You can assign drivers, change windows, reorder runs, edit the tracker's notes and details, raise follow-ups, put orders on the board, and read the mailbox for payments. Do these now, then say so. Every finished task is also emailed to him.
- PRICING AND MONEY ARE HIS DECISION. Anything about a price, a charge, what a driver is paid, a payment, or a tracker retail, condition or status: say what you want to do, the numbers, and your reason, then ask. Only after his yes (the tool will make you read it back and wait) does it run. He may answer yes, no, or give you his own number; for a unit he may give a different list price AND reseller price.
- STOCK THAT IS NOT MOVING: when a unit has sat ninety days or more with a healthy margin, ring him with it. Say the age, the margin and the list price, suggest a new price, and ask. Use stale_stock for the figures.
- REFUNDS, DISCOUNTS AND VOIDS happen ONLY when he tells you to. You may suggest one if you see a reason, but never start it and never do one because a customer asked.
- ANYTHING OVER FIFTY DOLLARS is read to him as a big one before it runs.
- PAYMENTS: when an e-transfer email matches an invoice on amount, date and name, scan_payments marks it paid by itself. If the amount fits but the NAME is different, tell him so; if it is unclear, ask.
- Delivery pricing is from the rate sheet: white glove, full zone rate by driving km from CDA, plus the extras. A CDA exchange is billed as two haul-aways. A washer or dryer install is a stacking install only if the stop says stacked; otherwise check the crew's photos yourself first, then call him to CONFIRM what you found. Never ask him to do your checking.
- Recommend. When he asks what to do, give your actual pick and one reason, not a menu.
- Other fixes you have: stock photos, the inventory sync, old unclosed stops, the backup. Those need his yes: read it back, ask, then call the tool again with the same arguments.
- Anything that needs code, a setting or a secret: request_code_change, and tell him it is queued for the developer.
- If he says a model number, stop number, invoice number or name, read it back before you act on it. A misheard number is a driver at the wrong door or the wrong invoice voided.
- HARD LIMITS, no matter who asks: you never send money out of the bank, change bank details or who has access, delete records, or contact a customer yourself. Say that needs him on the screen, and offer a follow-up task or a note.
- WORKING A LIST IS YOUR JOB, NOT HIS. When he says go through them (the late
  invoices, say), you drive it one at a time: call next_overdue_invoice, read it
  out in one breath ("Number one of eighteen: Rogers Appliance, twelve hundred
  and forty dollars, forty days late. Is it still open?") and wait. NEVER tell
  him to go and check something, look it up, or open a screen: you hold the data
  and he is on the phone because he does not want to.
  - "Still open" / "not paid yet": resolve_invoice still_owing (add promised_on if
    he gives a date), then say "Okay, kept open and a follow-up is raised", and go
    straight to the next one.
  - "Paid" with a date ("paid August 20th"): resolve_invoice paid with that date
    as YYYY-MM-DD in the current year (add method only if he said it). Say in one
    sentence what you did: it is recorded as paid on that date, it does not
    touch today's sales, and the customer is not emailed. Then the next one. If
    he says paid but gives no date, ask for the date, nothing else.
  - "Skip" / "later": resolve_invoice skip.
  - If he names someone you do not have in front of you, call find_overdue_invoice
    BEFORE answering. Speech-to-text mangles names. Never say "there is no
    such person" and move on: say what you found, or "I do not see an overdue
    invoice under that name, shall I carry on with the next one?"
  - If he redirects you ("no, go through all eighteen first"), do that at once,
    without apologising at length. Keep going until next_overdue_invoice says
    it is done, then give him a one-line tally: how many paid, how many still open.
- Do not invent facts. If you do not know, say so and offer to note it.
- When he is finished, call end_call.
`.trim();
};

export async function managerTurn(callId, speech) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { say: 'I am not set up to talk right now. Nothing was changed.', done: true };
  const call = await getCall(callId);
  if (!call) return { say: 'This call is no longer on record. Nothing was changed.', done: true };

  const turn = (call.turns || 0) + 1;
  await query('UPDATE manager_calls SET turns = $2 WHERE id = $1', [Number(callId), turn]);

  const snap = call.issues?.list || [];
  const dept = deptKey(call.dept);
  const caller = call.caller || 'the owner';
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
      body: JSON.stringify({ model: MODEL(), max_tokens: 700, tools: toolsFor(dept, [...TOOLS, ...MONEY_TOOLS]), system: SYSTEM(snap, today, notes, dept, caller), messages })
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
          system: SYSTEM(snap, today, notes, dept, caller) + '\n\nThe call is finishing. Say in one short sentence what you did on this call (or that you changed nothing), then goodbye.',
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
  if (call.trigger === 'inbound') {
    const { unreportedActions, reportLine, markReported } = await import('./manager-actions');
    const done = await unreportedActions();
    const told = reportLine(done);
    if (told) await markReported(done.map((a) => a.id)).catch(() => {});
    const d = DEPTS[deptKey(call.dept)];
    return `${call.caller ? `Hi ${call.caller}. ` : ''}${d.label} here. ${told ? `${told} ` : ''}What do you need?`;
  }
  const notes = await openNotes();
  const { unreportedActions, reportLine, markReported } = await import('./manager-actions');
  const done = await unreportedActions();
  const line = openingLine(call.issues?.list || [], { hidden: call.issues?.hidden || 0, notes: notes.length });
  const told = reportLine(done);
  // Reported means SAID. Mark them only when the call has been answered, so a
  // ring that went to voicemail does not swallow the report.
  if (told) await markReported(done.map((a) => a.id)).catch(() => {});
  return told ? `${line.replace(/ Want me to go through them\?$/, '')} ${told} Want me to go through what is left?` : line;
}

// ── Taking a call (the owner, or Ravi, ringing in at any time) ───────────────
// The caller's number is checked against CALLERS BEFORE anything is said or any
// row is written: an inbound line that answers anybody is a back door. Returns
// null for a number that is not on the list.
export async function startInboundCall({ from, callSid = null, dept = 'gm' } = {}) {
  const who = callerFor(from);
  if (!who) return null;
  await ensureManagerSchema();
  const found = await scanIssues().catch(() => ({ issues: [], hidden: [] }));
  const { rows: [row] } = await query(
    `INSERT INTO manager_calls (call_sid, to_number, trigger, status, issues, caller, dept, answered_at)
     VALUES ($1, $2, 'inbound', 'answered', $3::jsonb, $4, $5, now()) RETURNING id`,
    [callSid, from, JSON.stringify({ list: found.issues, hidden: found.hidden?.length || 0 }), who.name, deptKey(dept)]);
  return { id: row.id, caller: who.name, dept: deptKey(dept) };
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
    `INSERT INTO manager_calls (to_number, trigger, issues, caller) VALUES ($1, $2, $3::jsonb, 'Owner') RETURNING id`,
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

async function emailWhatIDid(since) {
  try {
    const { unreportedActions, reportLine, markReported } = await import('./manager-actions');
    const fresh = (await unreportedActions()).filter((a) => a.via === 'auto' && new Date(a.at) >= since);
    if (!fresh.length) return false;
    const to = process.env.SERVICE_EMAIL || 'service@rssolutions.ca';
    const html = `<p>${esc(reportLine(fresh))}</p><ul>${fresh.map((a) => `<li>${esc(a.summary)}</li>`).join('')}</ul><p>Everything here can be undone from its own screen. The full list is on <a href="${SITE_URL}/admin/manager">the Manager page</a>. — your Manager</p>`;
    const r = await sendEmail({ to, subject: `Manager: I did ${fresh.length} ${fresh.length === 1 ? 'thing' : 'things'}`, html });
    if (r?.ok) { await markReported(fresh.map((a) => a.id)); return true; }
  } catch (e) { console.error('manager report email failed', e?.message || e); }
  return false;
}

// The scheduled pass: scan, decide, and ring only when it is worth it.
export async function runManagerPass({ dry = false } = {}) {
  const passStart = new Date();
  let scan = await scanIssues();
  // ACT, THEN REPORT: clear what it safely can on its own before deciding
  // whether anything is left that is worth ringing about.
  const { runAutoActions } = await import('./manager-actions');
  const acted = await runAutoActions(scan.issues, { dry });
  if (!dry && Object.keys(acted).length) scan = await scanIssues();
  const today = await callsToday();
  const decision = shouldCallNow({ issues: scan.issues, today });
  const summary = { acted, issues: scan.issues.length, hidden: scan.hidden.length, attemptsToday: today.length, maxAttempts: MAX_ATTEMPTS_PER_DAY, ...decision };
  if (!decision.call || dry) {
    // Nobody is being rung, but it did things: say so by email rather than keep
    // them for the next call. Reported = told, one way or the other.
    if (!dry) summary.emailed = await emailWhatIDid(passStart);
    return { ok: true, called: false, ...summary };
  }
  const r = await startManagerCall({ trigger: 'cron', scan });
  return { ok: r.ok, called: r.ok, ...summary, ...(r.ok ? { callId: r.callId } : { reason: r.reason }) };
}

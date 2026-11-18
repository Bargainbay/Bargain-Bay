// The Tech Manager: manages the tech / refurb department and nudges techs by text.
// Rules and wording: lib/tech-manager-rules.js (pure). Sending and the log: lib/staff-texts.js.
//
// WHAT IT WATCHES, for the people on the config's `people` list and nobody else:
//   shift_open   — a staff (/clock) or driver shift still open past `shiftLimitHours`.
//                  Read straight from our own tables.
//   no_parts     — a unit in repair with no parts-needed marked after `partsGraceMinutes`.
//   long_on_unit — one tech on one unit for more than `unitLimitHours` (owner: 3).
//   The last two live in RS Ops (its own database), so they are read through
//   GET <RS Ops>/api/intake/bench — see BENCH CONTRACT below. If RS Ops cannot be reached
//   or does not have that route yet, the shift nudges still go and the report says why the
//   other two did not run. A silent half-check is the failure this module is built against.
//
// IT ONLY EVER TEXTS A CONFIGURED PERSON, from the operations number, in production, inside
// the send window, subject to a cooldown and a daily cap. Everything is logged.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';
import { isProduction } from './environment';
import { torontoTime, torontoDate } from './constants';
import { staffByEmail, sendStaffText, nudgeHistory } from './staff-texts';
import {
  DEFAULT_CONFIG, normalizeConfig, normalizePerson, inWindow, matchPerson, mayNudge,
  plainMessage, messageOk, nudgePrompt
} from './tech-manager-rules';

const SETTING = 'tech_manager';
const BY = 'Tech Manager (AI)';
const RSOPS_BASE = () => process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca';

export async function getTechConfig() {
  return normalizeConfig(await getSetting(SETTING, DEFAULT_CONFIG));
}

export async function saveTechConfig(patch = {}) {
  const cur = await getTechConfig();
  const next = normalizeConfig({ ...cur, ...patch, people: patch.people ?? cur.people });
  await setSetting(SETTING, next);
  return next;
}

/** Add or change ONE person's row (email is the key). banter / lang are theirs alone. */
export async function setTechPerson(person) {
  const p = normalizePerson(person);
  if (!p) throw new Error('A person needs an email address.');
  const cur = await getTechConfig();
  const prev = cur.people.find((x) => x.email === p.email);
  const merged = { ...prev, ...p,
    // a field not passed keeps its value (a partial post must not switch banter off or on)
    banter: person.banter === undefined ? prev?.banter === true : p.banter,
    lang: person.lang === undefined ? prev?.lang || 'en' : p.lang,
    names: person.names === undefined ? prev?.names || [] : p.names };
  return saveTechConfig({ people: [...cur.people.filter((x) => x.email !== p.email), merged] });
}

export async function removeTechPerson(email) {
  const cur = await getTechConfig();
  return saveTechConfig({ people: cur.people.filter((x) => x.email !== String(email || '').toLowerCase()) });
}

// ── What to nudge about ─────────────────────────────────────────────────────

const since = (iso, now) => {
  const d = new Date(iso);
  const sameDay = torontoDate(d) === torontoDate(now);
  return sameDay ? torontoTime(d)
    : `${d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric' })} ${torontoTime(d)}`;
};

export async function openShiftNudges(cfg, now = new Date()) {
  if (!hasDb() || !cfg.people.length) return [];
  const emails = cfg.people.map((p) => p.email);
  const out = [];
  const take = (r, source) => {
    const hours = (now - new Date(r.started_at)) / 3600_000;
    if (hours < cfg.shiftLimitHours) return;
    out.push({
      kind: 'shift_open', personEmail: String(r.email).toLowerCase(), subject: `${source}:${r.id}`,
      hours, since: since(r.started_at, now)
    });
  };
  try {
    const { rows } = await query(
      `SELECT s.id, s.started_at, e.email FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
        WHERE s.ended_at IS NULL AND lower(e.email) = ANY($1::text[])`, [emails]);
    rows.forEach((r) => take(r, 'staff'));
  } catch { /* handled as "nothing found" */ }
  try {
    const { rows } = await query(
      `SELECT s.id, s.started_at, u.email FROM driver_shifts s JOIN users u ON u.id = s.user_id
        WHERE s.ended_at IS NULL AND lower(u.email) = ANY($1::text[])`, [emails]);
    rows.forEach((r) => take(r, 'driver'));
  } catch { /* same */ }
  return out;
}

// BENCH CONTRACT (RS Ops → us). RS Ops owns the units; this module needs one read-only route,
//   GET /api/intake/bench    (header x-rsops-key: RSOPS_INTAKE_KEY, same as the other intake routes)
//   → { units: [{ id, model, stage, assignedToName, assignedToEmail?, workingSince, partsMarked }] }
// for units on OUR OWN lots that are in a repair stage (diagnosis / repair / waiting on parts is NOT
// included: waiting on a part is a reason, not a stall). `workingSince` is when the current tech
// started on the unit (ISO). `partsMarked` is true when the parts-needed list has anything in it OR
// the tech marked "needs no parts". No cost or price is ever part of it.
export async function fetchBench() {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return { ok: false, error: 'RSOPS_INTAKE_KEY is not set', units: [] };
  try {
    const res = await fetch(`${RSOPS_BASE()}/api/intake/bench`, {
      headers: { 'x-rsops-key': key }, cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `RS Ops answered ${res.status}`, units: [] };
    return { ok: true, units: Array.isArray(body.units) ? body.units : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'RS Ops unreachable', units: [] };
  }
}

export function benchNudges(cfg, units, now = new Date()) {
  const out = [];
  for (const u of units || []) {
    const person = matchPerson(cfg, { email: u.assignedToEmail, name: u.assignedToName });
    if (!person || !u.id) continue;
    const startedMs = Date.parse(u.workingSince);
    if (!Number.isFinite(startedMs)) continue;
    const mins = (now - startedMs) / 60_000;
    const base = { personEmail: person.email, subject: String(u.id), unit: String(u.id), model: u.model || '' };
    if (!u.partsMarked && mins >= cfg.partsGraceMinutes) {
      out.push({ ...base, kind: 'no_parts', hours: mins / 60 });
    }
    if (mins >= cfg.unitLimitHours * 60) {
      out.push({ ...base, kind: 'long_on_unit', hours: mins / 60 });
    }
  }
  return out;
}

// ── Writing the text ────────────────────────────────────────────────────────

async function aiMessage(nudge, person) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.TECH_MANAGER_MODEL || 'claude-sonnet-5-5',
        max_tokens: 400,
        system: nudgePrompt(person),
        messages: [{ role: 'user', content: `The situation: ${JSON.stringify({
          kind: nudge.kind, unit: nudge.unit || null, model: nudge.model || null,
          hours: Math.round(nudge.hours * 10) / 10, clockedInSince: nudge.since || null
        })}. Write the text.` }]
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim().replace(/^["“]|["”]$/g, '');
  } catch { return null; }
}

/** The AI's wording if it still carries the instruction, else the plain template. Never empty. */
export async function composeNudge(nudge, person) {
  const ai = await aiMessage(nudge, person);
  if (ai && messageOk(nudge, ai)) return { body: ai, by: 'ai' };
  return { body: plainMessage(nudge, person), by: 'template' };
}

// ── The pass ────────────────────────────────────────────────────────────────

/**
 * Work out who would be texted and what they would be sent. `dry` writes nothing and sends
 * nothing; it works even when the feature is switched off, which is how it is previewed.
 */
export async function runTechManager({ dry = false, now = new Date(), bench = null } = {}) {
  const cfg = await getTechConfig();
  const report = { dry, enabled: cfg.enabled, sent: [], would: [], held: [], notes: [], benchError: null };
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);

  if (!dry) {
    if (!cfg.enabled) return { ...report, skipped: 'switched off' };
    if (!isProduction()) return { ...report, skipped: 'not production' };
    if (!inWindow(cfg, hhmm)) return { ...report, skipped: `outside ${cfg.windowStart}-${cfg.windowEnd} Toronto` };
  } else {
    if (!cfg.enabled) report.notes.push('Switched off: a real run would send nothing.');
    if (!isProduction()) report.notes.push('Not production: a real run would send nothing.');
    if (!inWindow(cfg, hhmm)) report.notes.push(`Outside ${cfg.windowStart}-${cfg.windowEnd} Toronto: a real run would send nothing right now.`);
  }
  if (!cfg.people.length) return { ...report, skipped: 'no people configured' };

  const found = await fetchBenchOnce(bench, report);
  const nudges = [...(await openShiftNudges(cfg, now)), ...benchNudges(cfg, found, now)];

  for (const n of nudges) {
    const person = cfg.people.find((p) => p.email === n.personEmail);
    const to = person && await staffByEmail(person.email);
    const label = { kind: n.kind, subject: n.subject, to: to?.name || person?.email };
    if (!to?.phoneKey) { report.held.push({ ...label, why: 'no phone number on file' }); continue; }
    const may = mayNudge(cfg, await nudgeHistory(person.email), { nudge: n.kind, subject: n.subject }, now.getTime());
    if (!may.ok) { report.held.push({ ...label, why: may.why }); continue; }
    const { body, by } = await composeNudge(n, person);
    if (dry) { report.would.push({ ...label, banter: person.banter, lang: person.lang, written: by, body }); continue; }
    const r = await sendStaffText({ to, body, kind: 'nudge', nudge: n.kind, subject: n.subject, sentBy: BY });
    report.sent.push({ ...label, ok: r.ok, status: r.status, reason: r.reason, body });
  }
  return report;
}

async function fetchBenchOnce(preloaded, report) {
  const b = preloaded || await fetchBench();
  if (!b.ok) {
    report.benchError = b.error;
    report.notes.push(`Parts and time-on-unit nudges did not run: ${b.error}.`);
    return [];
  }
  return b.units;
}

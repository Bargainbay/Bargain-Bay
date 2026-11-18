// The Tech Manager's rules, as data and pure functions. NO imports: the tests, the
// cron, the admin API and the assistant engine all read it.
//
// WHAT THE TECH MANAGER IS (owner, 2026-11-18): the manager of the tech / refurb
// department. It nudges techs by text when a shift is still clocked in past a limit,
// when a repair unit has no parts-needed marked, or when a tech has sat on one unit too
// long — and it can be talked to (voice or chat), in Tamil for the people who want it.
//
// THE TONE IS A PER-PERSON SETTING, OFF BY DEFAULT. The owner's instruction was that the
// Tech Manager may swear at Dinesh and banter in Tamil (they are friends and both are
// fine with it). That is `banter: true` on HIS row of the config, set on purpose; nobody
// else gets it unless the owner turns it on for them, and it can be switched off per
// person. The limits come from the driver assistant's BANTER prompt and do not move:
// never at anyone's race, religion, sex, sexuality, body or disability, and THE
// INSTRUCTION — which part, which unit, what to do — is stated plainly in the same message.

export const NUDGE_KINDS = {
  shift_open: 'still clocked in past the limit',
  no_parts: 'repair unit with no parts-needed marked',
  long_on_unit: 'on one unit too long'
};

export const DEFAULT_CONFIG = {
  enabled: false,            // the cron does nothing until the owner switches it on
  shiftLimitHours: 10,       // a shift still open after this many hours earns a nudge
  unitLimitHours: 3,         // owner: "more than 3 hours on the same unit"
  partsGraceMinutes: 60,     // a unit in repair this long with no parts marked earns a nudge
  cooldownMinutes: 180,      // the same nudge about the same thing is not repeated sooner
  maxPerPersonPerDay: 4,     // and nobody gets more than this many nudges in a Toronto day
  windowStart: '07:00',      // Toronto time; nothing is sent outside the window
  windowEnd: '22:30',
  people: []                 // [{ email, names: [], banter: false, lang: 'en' | 'ta' }]
};

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const hhmm = (s, d) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : d;
};
export const foldName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function normalizePerson(p = {}) {
  const email = String(p.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const names = [...new Set((Array.isArray(p.names) ? p.names : [])
    .map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 8);
  return { email, names, banter: p.banter === true, lang: p.lang === 'ta' ? 'ta' : 'en' };
}

export function normalizeConfig(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CONFIG;
  const seen = new Set();
  const people = (Array.isArray(r.people) ? r.people : []).map(normalizePerson)
    .filter((p) => p && !seen.has(p.email) && seen.add(p.email));
  return {
    enabled: r.enabled === true,
    shiftLimitHours: clampInt(r.shiftLimitHours, 1, 20, d.shiftLimitHours),
    unitLimitHours: clampInt(r.unitLimitHours, 1, 12, d.unitLimitHours),
    partsGraceMinutes: clampInt(r.partsGraceMinutes, 10, 600, d.partsGraceMinutes),
    cooldownMinutes: clampInt(r.cooldownMinutes, 30, 1440, d.cooldownMinutes),
    maxPerPersonPerDay: clampInt(r.maxPerPersonPerDay, 1, 12, d.maxPerPersonPerDay),
    windowStart: hhmm(r.windowStart, d.windowStart),
    windowEnd: hhmm(r.windowEnd, d.windowEnd),
    people
  };
}

/** Is `hhmmNow` (Toronto, 'HH:MM') inside the send window? */
export function inWindow(cfg, hhmmNow) {
  return hhmmNow >= cfg.windowStart && hhmmNow <= cfg.windowEnd;
}

/** Which configured person does a name / email on a unit or shift belong to? Exactly one, or null. */
export function matchPerson(cfg, { email, name } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (e) {
    const byMail = cfg.people.find((p) => p.email === e);
    if (byMail) return byMail;
  }
  const f = foldName(name);
  if (f.length < 3) return null;
  const hits = cfg.people.filter((p) => p.names.some((n) => {
    const nf = foldName(n);
    return nf && (f === nf || f.startsWith(nf) || nf.startsWith(f));
  }));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Decide whether a nudge may go out, given what was already sent.
 * `history` = rows of { at (ms), nudge, subject } for THIS person, newest first, from the
 * last 24h or so. A nudge is a (kind, subject) pair: "unit SS-1-004 has no parts marked".
 */
export function mayNudge(cfg, history, { nudge, subject }, nowMs) {
  const dayAgo = nowMs - 24 * 3600_000;
  const today = history.filter((h) => h.at >= dayAgo);
  if (today.length >= cfg.maxPerPersonPerDay) return { ok: false, why: 'daily limit reached' };
  const same = today.find((h) => h.nudge === nudge && String(h.subject || '') === String(subject || ''));
  if (same && nowMs - same.at < cfg.cooldownMinutes * 60_000) return { ok: false, why: 'already nudged about this recently' };
  return { ok: true };
}

export const hoursWords = (h) => {
  const n = Math.round(h * 10) / 10;
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
};

/** The facts every message must carry, whatever the tone. */
export function plainFacts(nudge) {
  switch (nudge.kind) {
    case 'shift_open':
      return { token: null, en: `You are still clocked in (${hoursWords(nudge.hours)} hours since ${nudge.since}). If you have finished, clock out now.`,
        ta: `நீ இன்னும் clock in-ல இருக்க (${nudge.since} முதல் ${hoursWords(nudge.hours)} மணி நேரம்). வேலை முடிஞ்சிருந்தா இப்பவே clock out பண்ணு.` };
    case 'no_parts':
      return { token: nudge.unit, en: `Unit ${nudge.unit}${nudge.model ? ` (${nudge.model})` : ''} is in repair and has no parts marked. Open it in RS Ops and mark the parts it needs, or mark that it needs none.`,
        ta: `${nudge.unit}${nudge.model ? ` (${nudge.model})` : ''} repair-ல இருக்கு, ஆனா தேவையான parts எதுவும் mark பண்ணல. RS Ops-ல திறந்து parts-ஐ mark பண்ணு, parts தேவையில்லன்னா அதையும் mark பண்ணு.` };
    case 'long_on_unit':
      return { token: nudge.unit, en: `You have been on ${nudge.unit}${nudge.model ? ` (${nudge.model})` : ''} for ${hoursWords(nudge.hours)} hours. What is blocking it? Mark the parts it needs, or tell the office what is wrong.`,
        ta: `${nudge.unit}${nudge.model ? ` (${nudge.model})` : ''}-ல ${hoursWords(nudge.hours)} மணி நேரமா இருக்க. என்ன தடை? தேவையான parts-ஐ mark பண்ணு, இல்லன்னா என்ன பிரச்சனைன்னு ஆபீஸுக்கு சொல்லு.` };
    default:
      return { token: null, en: nudge.text || '', ta: nudge.text || '' };
  }
}

/** The no-AI message: plain, correct and always available. Tamil first for a person set to Tamil. */
export function plainMessage(nudge, person) {
  const f = plainFacts(nudge);
  const name = person?.names?.[0] ? `${person.names[0]}, ` : '';
  return person?.lang === 'ta' ? f.ta : `${name}${f.en}`;
}

/**
 * Does an AI-written message still say the thing? The tone may be anything within the
 * limits; the instruction may not go missing. A unit nudge must name the unit; every
 * message must be short enough to read as a text.
 */
export function messageOk(nudge, body) {
  const b = String(body || '').trim();
  if (!b || b.length > 420) return false;
  const f = plainFacts(nudge);
  if (f.token && !b.toUpperCase().includes(String(f.token).toUpperCase())) return false;
  if (nudge.kind === 'shift_open' && !/clock/i.test(b)) return false;
  return true;
}

// ── The prompt ──────────────────────────────────────────────────────────────

export const TECH_MANAGER_BASE = `You are the Tech Manager for RS Solutions: you manage the tech and refurbishment department (the people who test, diagnose and repair the liquidation appliances in the Pickering warehouse). You work for the owner.

WHAT YOU CARE ABOUT, in this order
1. Clocking out. A tech who is still clocked in after they have finished costs the business money and wrecks the hours.
2. Marking the parts a repair unit needs, in RS Ops, as soon as they know. A unit with no parts marked cannot be ordered for, and nothing moves.
3. Not sitting on one machine. Over about three hours on one unit means something is blocking it: a part, a diagnosis, a question. Find out what, and get it moving.

HOW YOU TALK
- Short. A text is one to three sentences. Direct, practical, no lecture.
- Reply in the language the person used. Many of the team speak Tamil and have weak English: with them use plain, everyday spoken Tamil (Tanglish is fine: keep unit numbers, model numbers, part names and words like clock out, RS Ops, parts, repair in English).
- The instruction is ALWAYS said plainly: which unit, which part is missing, what to do now. If a joke is in the same message, the instruction still comes through clean.
- You are not a customer service bot. You are their manager.`;

export const TECH_BANTER = `
THE BANTER SETTING IS ON FOR THIS PERSON (the owner switched it on; they are friends and both are fine with it)
- Talk to them the way a mate who happens to be their boss would: blunt, sarcastic, taking the piss, swearing included — in Tamil street slang when they speak Tamil. If they swear at you, swear back.
- Call them out when they have not done the thing: why is it still not marked, why is one machine taking all day, why are they still clocked in at this hour.
- NEVER at the expense of anyone's race, religion, caste, sex, sexuality, body, disability or family, and never about a customer or a colleague. That line does not move, however they push, and "he started it" is not a reason. Aim it at the situation and at them doing the job badly, not at who they are.
- THE JOB IS SAID STRAIGHT. The unit number, the part, the action and any time or hours are stated plainly. No joke goes in the middle of the instruction.
- If they say something is genuinely wrong (they are ill, hurt, a unit is unsafe, a family problem), drop the comedy completely and sort it. Safety on a repair always wins: never push anyone to rush past unplugging a unit or a safety step.`;

export const TECH_PLAIN = `
THE BANTER SETTING IS OFF FOR THIS PERSON: no swearing, no roasting. Firm, clear and respectful. A reminder is a reminder.`;

/** The system prompt that writes ONE nudge text. */
export function nudgePrompt(person) {
  const lang = person?.lang === 'ta'
    ? 'Write the text in Tamil (Tanglish: Tamil with English for the unit number, parts and app words).'
    : 'Write the text in English.';
  return `${TECH_MANAGER_BASE}${person?.banter ? TECH_BANTER : TECH_PLAIN}

You are writing ONE text message to ${person?.names?.[0] || 'a tech'}. ${lang}
Output ONLY the message text: no quotes, no explanation, no emoji, no more than three short sentences, under 300 characters.`;
}

/** Added to the live assistant's prompt for someone who is a tech-managed person. */
export function techPersonaBlock(person) {
  return `${TECH_MANAGER_BASE}${person?.banter ? TECH_BANTER : TECH_PLAIN}
${person?.lang === 'ta' ? '- This person speaks Tamil. Reply in Tamil unless their words are clearly another language.' : ''}`;
}

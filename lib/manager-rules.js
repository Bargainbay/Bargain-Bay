// The Voice Manager's judgement, with no imports: what counts as worth a phone
// call, when it may ring, and what it says first. Pure so it can be tested
// without a database, a clock or a phone, and so the call route and the cron
// cannot disagree about any of it.
//
// THE OPENING LINE IS ARITHMETIC OFF THE SCAN, never something the model reads
// back — there is no reason to give it a chance to get a count wrong.

export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

// The owner's number is set in lib/manager-call.js (env / setting / default).
// Calls are only placed between these Toronto hours: a phone ringing at 3am about
// a missing photo is the fastest way to get the whole thing switched off.
export const CALL_HOURS = { from: 8, to: 20 };
// A day's worth of trying: ring up to this many times, stop at the first answer.
export const MAX_ATTEMPTS_PER_DAY = 3;
// Retries are spaced out, or three rings in three minutes is one annoying call.
export const MIN_GAP_MINUTES = 90;

export function rankIssues(issues = []) {
  return [...issues].sort((a, b) =>
    (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
    || (b.count || 0) - (a.count || 0)
    || String(a.key).localeCompare(String(b.key)));
}

// Snoozes: { [issueKey]: ISO until }. A snoozed issue is hidden, and COUNTED, so
// "3 snoozed" is never a silent number.
export function applySnoozes(issues = [], snoozes = {}, now = Date.now()) {
  const live = [];
  const hidden = [];
  for (const i of issues) {
    const until = snoozes?.[i.key] ? Date.parse(snoozes[i.key]) : 0;
    (until > now ? hidden : live).push(i);
  }
  return { live, hidden };
}

export function torontoHour(now = new Date()) {
  const h = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }).format(now);
  return Number(h) % 24;
}
export const inCallHours = (now = new Date()) => {
  const h = torontoHour(now);
  return h >= CALL_HOURS.from && h < CALL_HOURS.to;
};

// Should the scheduled pass ring right now?
//   issues  — live (unsnoozed) issues
//   today   — today's calls: [{ status, started_at }]
// Only high and medium issues earn a call. A list of nothing but low items waits
// for the owner to ask (or for the Reports page); a call that is mostly trivia
// teaches him to ignore the call.
export function shouldCallNow({ issues = [], today = [], now = new Date() } = {}) {
  if (!inCallHours(now)) return { call: false, why: 'outside calling hours' };
  const worth = issues.filter((i) => i.severity === 'high' || i.severity === 'medium');
  if (!worth.length) return { call: false, why: 'nothing worth a call' };
  if (today.some((c) => c.status === 'answered' || c.status === 'done')) return { call: false, why: 'already spoke today' };
  if (today.length >= MAX_ATTEMPTS_PER_DAY) return { call: false, why: 'tried enough times today' };
  const last = today.map((c) => Date.parse(c.started_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (last && now.getTime() - last < MIN_GAP_MINUTES * 60_000) return { call: false, why: 'rang recently' };
  return { call: true, why: `${worth.length} to talk about` };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

// What it says when he picks up.
export function openingLine(issues = [], { hidden = 0, notes = 0 } = {}) {
  const ranked = rankIssues(issues);
  if (!ranked.length) {
    return `Hi, it's your Bargain Bay manager. Nothing needs you right now.${notes ? ` You have ${plural(notes, 'open note')} from me.` : ''} Anything you want me to look into?`;
  }
  const high = ranked.filter((i) => i.severity === 'high').length;
  const med = ranked.filter((i) => i.severity === 'medium').length;
  const low = ranked.length - high - med;
  const bits = [];
  if (high) bits.push(`${high} urgent`);
  if (med) bits.push(`${med} worth your time`);
  if (low) bits.push(`${low} small`);
  const first = ranked[0];
  return `Hi, it's your Bargain Bay manager. I found ${plural(ranked.length, 'thing')}: ${bits.join(', ')}.`
    + ` The most important is ${first.speak || first.title}.`
    + (hidden ? ` ${plural(hidden, 'more is', 'more are')} snoozed.` : '')
    + ' Want me to go through them?';
}

// A US/Canada number to E.164, or null. Used on the one configured number only.
export function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return null;
}

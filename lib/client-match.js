// Reading a client's name off a sheet and deciding which of OUR clients it is.
//
// The sheet never spells it the way the clients table does. "Canadian Discount
// Appliances" arrives as CDA, as "Canadian Discount Appl.", as "CANADIAN
// DISCOUNT APPLIANCES INC", as a filename. A dispatcher fixing that on every
// row is the whole complaint this module exists to answer.
//
// Two rules hold everything else up:
//
//   1. A match is either CONFIDENT enough to apply on its own or it is a
//      SUGGESTION a person confirms. There is no middle setting that quietly
//      files a day's stops under the wrong company — that is the failure being
//      fixed, and a fuzzy matcher is perfectly capable of recreating it.
//   2. A name on a sheet NEVER creates a client. A parser inventing companies
//      leaves a client list nobody can invoice from. Unknown names come back as
//      unknown, with the name preserved so the answer is one tap.
//
// Pure functions over a client list — no database, so the voice agent, the
// importer and the browser can all run the same matching.

// Corporate noise. Two companies are not different because one of them wrote
// "Inc." — but "Appliances" is load-bearing and stays.
const SUFFIXES = /\b(inc|inc'd|incorporated|ltd|ltee|lt[ée]e|limited|llc|llp|corp|corporation|co|company|enterprises|holdings|group|intl|international)\b/g;
const NOISE = /\b(the|and|of|for|&)\b/g;

export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,'’"()\/\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s) => normalizeName(s).split(' ').filter(Boolean);

// CDA ← Canadian Discount Appliances. Only from the significant tokens, so
// "The Brick Ltd" gives B and not TBL.
function initials(name) {
  return tokens(name).map((t) => t[0]).join('');
}

// Levenshtein, capped — these are company names, not documents.
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

const similarity = (a, b) => {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - editDistance(a, b) / longest : 0;
};

// How well does `candidate` (off the sheet) name `client`? Higher is better;
// null means not a match at all. The score also carries WHY, because the voice
// agent has to be able to say "I matched CDA to Canadian Discount Appliances"
// rather than announce a decision with no reason attached.
function scoreOne(candidate, client, aliases = []) {
  const c = normalizeName(candidate);
  if (!c) return null;
  const n = normalizeName(client.name);

  if (c === n) return { score: 1, why: 'exact name', confident: true };

  for (const a of aliases) {
    if (normalizeName(a) === c) return { score: 0.99, why: `known as “${a}”`, confident: true };
  }

  // An initialism only counts when it is short and unambiguous. "CDA" is a
  // three-letter word nobody types by accident; a two-letter one is a coin flip
  // and stays a suggestion.
  const ini = initials(client.name);
  if (ini.length >= 3 && c.replace(/\s+/g, '') === ini) {
    return { score: 0.95, why: `initials of ${client.name}`, confident: true };
  }

  const ct = tokens(candidate);
  const nt = tokens(client.name);
  if (ct.length && nt.length) {
    // Every word of one appears in the other: "Canadian Discount Appl" inside
    // "Canadian Discount Appliances", or the sheet carrying the longer legal
    // name. Single-token containment is far too loose to be confident — half
    // the client list would match the word "appliances".
    const covers = (small, big) => small.every((t) => big.some((u) => u === t || (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u))));
    if (covers(ct, nt) || covers(nt, ct)) {
      const strong = Math.min(ct.length, nt.length) >= 2;
      return { score: strong ? 0.9 : 0.6, why: `matches ${client.name}`, confident: strong };
    }
  }

  const sim = similarity(c, n);
  // A typo, a missing letter, a doubled space. Never confident on its own —
  // "Parallel Supply" and "Paragon Supply" are one edit apart in spirit and two
  // different companies in the driveway.
  if (sim >= 0.82) return { score: sim * 0.7, why: `looks like ${client.name}`, confident: false };

  return null;
}

// The one entry point. Give it whatever the sheet said and the client list;
// get back what to do about it.
//
// Returns { clientId, client, confident, why, alternatives[] } — or
// { clientId: null, unknown: name } when nothing plausibly matches.
export function matchClient(candidate, clients = [], aliasesByClient = {}) {
  const name = String(candidate || '').trim();
  if (!name) return { clientId: null, confident: false, why: null, alternatives: [] };

  const scored = clients
    .map((c) => {
      const s = scoreOne(name, c, aliasesByClient[c.id] || []);
      return s ? { client: c, ...s } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { clientId: null, confident: false, unknown: name, why: null, alternatives: [] };

  const [best, second] = scored;
  // Two clients matched about equally well. Applying either is a guess, and a
  // guess here is exactly the bug — hand both back and let a person pick.
  const ambiguous = second && best.score - second.score < 0.1;

  return {
    clientId: best.client.id,
    client: best.client,
    confident: best.confident && !ambiguous,
    why: ambiguous ? `could be ${best.client.name} or ${second.client.name}` : best.why,
    alternatives: scored.slice(1, 4).map((s) => ({ id: s.client.id, name: s.client.name, why: s.why }))
  };
}

// A filename is a weak but genuinely useful signal: people name the attachment
// after whoever sent it ("CDA deliveries Aug 30.xlsx", "canadian_discount
// 08-30.xlsx"). Strip the date and extension noise and see if a client's name
// is sitting inside what's left.
export function clientFromFilename(filename, clients = [], aliasesByClient = {}) {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\b\d{1,4}[-_ .]\d{1,2}([-_ .]\d{1,4})?\b/g, ' ')   // 08-30, 2026-08-30
    .replace(/\b(run ?sheet|deliveries|delivery|stops|runs?|manifest|schedule|bol|final|copy|updated?|new|revised)\b/gi, ' ');
  const words = normalizeName(base);
  if (!words) return { clientId: null, confident: false };

  // Try the whole thing first, then every run of words in it — the client name
  // is usually a fragment of the filename, not the whole of it.
  const direct = matchClient(words, clients, aliasesByClient);
  if (direct.confident) return { ...direct, why: `the filename says “${words}”` };

  const parts = words.split(' ');
  for (let len = Math.min(4, parts.length); len >= 1; len--) {
    for (let i = 0; i + len <= parts.length; i++) {
      const m = matchClient(parts.slice(i, i + len).join(' '), clients, aliasesByClient);
      if (m.confident) return { ...m, why: `the filename says “${parts.slice(i, i + len).join(' ')}”` };
    }
  }
  return { clientId: null, confident: false, alternatives: direct.alternatives || [] };
}

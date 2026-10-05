// The Thanksgiving giveaway: entries, and the draw.
//
// CANADIAN CONTEST RULES THIS IS BUILT AROUND (have a lawyer read the rules page
// before it goes public; this file implements what the rules say, it does not
// replace them):
//  · no purchase necessary, and nothing about an entry depends on buying;
//  · a chance-based prize draw must make the selected winner correctly answer a
//    skill-testing question before the prize is awarded. That happens when we
//    contact the winner, which is why there is a `winner` state and a
//    `forfeited` one: a winner who cannot answer is struck off and we redraw;
//  · Ontario residents 18+ only. The postal code is checked for an Ontario
//    prefix (K, L, M, N, P), which keeps Quebec (and its separate regime for
//    contests) out without us having to run one;
//  · marketing consent is a separate, unticked box and never a condition of
//    entry. It is recorded through lib/consent with the wording shown.
import { randomInt } from 'node:crypto';
import { query, hasDb } from './db';
import { phoneKey } from './constants';
import { normEmail, ensureConsentSchema } from './consent';
import { linkToken } from './links';
import { ticketsOf } from './deals-config';

export const ONTARIO_POSTAL = /^[KLMNP]\d[A-Z]/;

// One inbox, one ticket. "me+1@x.com" and "me+2@x.com" are the same person, and
// so is "Me@X.com". (Gmail's dots are NOT collapsed: that is a Gmail-ism, and
// merging "a.b@x.com" with "ab@x.com" on other providers would drop a real,
// different entrant.)
export function entryKey(email) {
  const e = normEmail(email);
  if (!e) return null;
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at).split('+')[0];
  return local ? `${local}@${e.slice(at + 1)}` : null;
}

export function postalPrefix(v) {
  const p = String(v || '').toUpperCase().replace(/\s+/g, '').slice(0, 3);
  return ONTARIO_POSTAL.test(p) ? p : null;
}

export const MAX_ENTRIES_PER_IP_HOUR = 5;

// { ok:true, entered:true } | { ok:true, entered:false } (already in) | { ok:false, error }
export async function enterGiveaway(giveaway, input, { ip = null, userAgent = null } = {}) {
  if (!hasDb()) return { ok: false, error: 'Entries are briefly unavailable. Please try again soon.' };
  const name = String(input.name || '').trim().slice(0, 120);
  const email = normEmail(input.email);
  const key = entryKey(email);
  if (!name) return { ok: false, error: 'Please enter your name.' };
  if (!key) return { ok: false, error: 'Please enter a valid email address.' };
  const postal = postalPrefix(input.postal);
  if (!postal) return { ok: false, error: 'This giveaway is open to Ontario residents. Please enter your Ontario postal code.' };
  if (!input.eligible) return { ok: false, error: 'Please confirm you are 18 or older, live in Ontario, and have read the contest rules.' };

  if (ip && ip !== 'unknown') {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM giveaway_entries
        WHERE giveaway = $1 AND ip = $2 AND created_at > now() - interval '1 hour'`,
      [giveaway, ip]
    );
    if (Number(rows[0]?.n || 0) >= MAX_ENTRIES_PER_IP_HOUR) {
      return { ok: false, error: 'Too many entries from this connection. Please try again later.' };
    }
  }

  const { rows } = await query(
    `INSERT INTO giveaway_entries
       (giveaway, name, email, entry_key, phone, postal_prefix, marketing_opt_in, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (giveaway, entry_key) DO NOTHING
     RETURNING id`,
    [giveaway, name, email, key, phoneKey(input.phone) ? String(input.phone).trim().slice(0, 40) : null,
     postal, !!input.marketing, ip, userAgent]
  );
  if (rows.length) return { ok: true, entered: true, id: rows[0].id, email, name };
  const { rows: prior } = await query(
    'SELECT id FROM giveaway_entries WHERE giveaway = $1 AND entry_key = $2', [giveaway, key]
  );
  return { ok: true, entered: false, id: prior[0]?.id || null, email, name };
}

// ---- one entry's link, status and tickets ---------------------------------------

// The entrant comes back to their checklist through "?e=<id>.<token>". The token
// is an HMAC of the id (lib/links), derived not stored, so there is no table of
// them and nothing to expire. It is handed to the browser that made the entry
// and emailed to the address on it, which is the only way back in.
export const entryParam = (id) => `${id}.${linkToken('giveaway', String(id))}`;

export function entryIdFromParam(param) {
  const [id, token] = String(param || '').split('.');
  if (!/^\d+$/.test(id || '') || !token) return null;
  return linkToken('giveaway', id) === token ? Number(id) : null;
}

// The flags a ticket count is derived from. ONE definition, used by the
// entrant's checklist, the admin screen and the draw, so what a person sees,
// what the admin sees and what the draw uses cannot disagree.
const FLAGS = `
  e.id, e.name, e.email, e.phone, e.postal_prefix, e.status, e.created_at,
  e.instagram_handle, e.video_status, e.note,
  EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(e.email)) AS has_account,
  COALESCE((SELECT c.event = 'granted' FROM consent_events c
             WHERE c.identity = lower(e.email) AND c.channel = 'email'
             ORDER BY c.at DESC, c.id DESC LIMIT 1), false) AS newsletter`;

const withTickets = (r) => ({ ...r, tickets: ticketsOf(r) });

export async function entryStatus(id) {
  if (!hasDb() || !id) return null;
  await ensureConsentSchema();
  const { rows } = await query(`SELECT ${FLAGS} FROM giveaway_entries e WHERE e.id = $1`, [id]);
  return rows[0] ? withTickets(rows[0]) : null;
}

// "@Bargain.Bay", "https://instagram.com/bargain.bay/?hl=en" -> "bargain.bay"
export function normalizeInstagram(v) {
  const s = String(v || '').trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s.toLowerCase() : null;
}

// Honour system: we cannot see who follows us from here, so the handle is a
// claim. The winner's follow is checked by a person before the prize goes out.
export async function setInstagram(id, handle) {
  const h = normalizeInstagram(handle);
  if (!h) throw new Error('Enter your Instagram username, for example @yourname.');
  await query('UPDATE giveaway_entries SET instagram_handle = $2 WHERE id = $1', [id, h]);
  return h;
}

export const videoPrefix = (giveaway, id) => `giveaway/${giveaway}/${id}-`;

// The browser uploads straight to the private store (a phone video is far over
// a serverless function's body limit) and then tells us where it went. The path
// must carry THIS entry's prefix, so nobody can attach somebody else's file or
// an arbitrary blob to their own entry.
export async function registerVideo(giveaway, id, pathname, release) {
  if (!release) throw new Error('Please tick the box that lets us share your video.');
  if (!String(pathname || '').startsWith(videoPrefix(giveaway, id))) throw new Error('That upload does not belong to this entry.');
  const { rows } = await query(
    `UPDATE giveaway_entries
        SET video_path = $2, video_status = 'pending', video_release = true,
            video_at = now(), video_reviewed_by = NULL
      WHERE id = $1 AND (video_status IS NULL OR video_status IN ('pending','rejected'))
      RETURNING id`, [id, pathname]
  );
  if (!rows.length) throw new Error('Your video has already been approved.');
  return true;
}

// ---- admin ------------------------------------------------------------------

export async function giveawayOverview(giveaway) {
  const empty = { total: 0, tickets: 0, optIns: 0, winner: null, history: [], videos: [] };
  if (!hasDb()) return empty;
  await ensureConsentSchema();
  const { rows } = await query(`SELECT ${FLAGS}, e.video_at FROM giveaway_entries e WHERE e.giveaway = $1 ORDER BY e.id`, [giveaway]);
  const all = rows.map(withTickets);
  const history = all.filter((r) => r.status !== 'entered')
    .sort((a, b) => b.id - a.id);
  return {
    total: all.length,
    // Only people still in the pot count towards the pot.
    tickets: all.filter((r) => r.status === 'entered').reduce((n, r) => n + r.tickets, 0),
    optIns: all.filter((r) => r.newsletter).length,
    winner: history.find((r) => r.status === 'winner' || r.status === 'claimed') || null,
    history,
    videos: all.filter((r) => r.video_status)
      .sort((a, b) => (a.video_status === 'pending' ? 0 : 1) - (b.video_status === 'pending' ? 0 : 1) || b.id - a.id)
  };
}

// Pick one item with probability proportional to its tickets. `rand(n)` returns
// an integer in [0, n); injectable so the arithmetic can be tested exactly.
export function pickWeighted(items, rand = randomInt) {
  const total = items.reduce((n, x) => n + x.tickets, 0);
  if (!total) return null;
  let r = rand(total);
  for (const x of items) {
    if (r < x.tickets) return x;
    r -= x.tickets;
  }
  return null;
}

/**
 * Draw one winner from the people still in the pot, weighted by tickets. Uses
 * the OS's CSPRNG (`randomInt`), not Math.random: a prize draw has to be
 * defensible.
 *
 * Refuses while a winner is still standing and unresolved: a double-click, or
 * two people on the screen, must not produce two winners.
 */
export async function drawWinner(giveaway, actor) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows: live } = await query(
    `SELECT 1 FROM giveaway_entries WHERE giveaway = $1 AND status = 'winner' LIMIT 1`, [giveaway]
  );
  if (live.length) throw new Error('There is already a winner waiting to be contacted. Mark them claimed, or forfeited, before drawing again.');
  await ensureConsentSchema();
  const { rows } = await query(
    `SELECT ${FLAGS} FROM giveaway_entries e WHERE e.giveaway = $1 AND e.status = 'entered' ORDER BY e.id`, [giveaway]
  );
  const pool = rows.map(withTickets);
  if (!pool.length) throw new Error('There are no eligible entries to draw from.');
  const pick = pickWeighted(pool);
  // The status guard makes a concurrent second draw fail rather than overwrite.
  const { rows: won } = await query(
    `UPDATE giveaway_entries
        SET status = 'winner', drawn_at = now(), drawn_by = $2
      WHERE id = $1 AND status = 'entered'
      RETURNING id, name, email, phone, postal_prefix, status, drawn_at, drawn_by, instagram_handle`,
    [pick.id, actor || null]
  );
  if (!won.length) throw new Error('That entry changed while drawing. Please draw again.');
  return { winner: { ...won[0], tickets: pick.tickets }, poolSize: pool.length, ticketsInPot: pool.reduce((n, x) => n + x.tickets, 0) };
}

export async function reviewVideo(giveaway, id, outcome, actor) {
  if (!['approved', 'rejected'].includes(outcome)) throw new Error('Unknown outcome.');
  const { rows } = await query(
    `UPDATE giveaway_entries SET video_status = $3, video_reviewed_by = $4
      WHERE id = $1 AND giveaway = $2 AND video_status IS NOT NULL RETURNING id`,
    [id, giveaway, outcome, actor || null]
  );
  if (!rows.length) throw new Error('No video on that entry.');
  return true;
}

// winner -> claimed (answered the question and took the prize), or
// winner -> forfeited (could not be reached, wrong answer, ineligible).
export async function resolveWinner(giveaway, id, outcome, note, actor) {
  if (!hasDb()) throw new Error('Database not configured.');
  if (!['claimed', 'forfeited'].includes(outcome)) throw new Error('Unknown outcome.');
  const { rows } = await query(
    `UPDATE giveaway_entries
        SET status = $3, note = $4, drawn_by = COALESCE(drawn_by, $5)
      WHERE id = $1 AND giveaway = $2 AND status = 'winner'
      RETURNING id`,
    [id, giveaway, outcome, String(note || '').slice(0, 500) || null, actor || null]
  );
  if (!rows.length) throw new Error('That entry is not a current winner.');
  return true;
}

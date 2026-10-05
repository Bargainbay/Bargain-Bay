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
import { normEmail } from './consent';

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
  return { ok: true, entered: rows.length > 0, email, name };
}

// ---- admin ------------------------------------------------------------------

export async function giveawayOverview(giveaway) {
  if (!hasDb()) return { total: 0, optIns: 0, winner: null, history: [] };
  const [{ rows: t }, { rows: w }] = await Promise.all([
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE marketing_opt_in)::int AS opt_ins
             FROM giveaway_entries WHERE giveaway = $1`, [giveaway]),
    query(`SELECT id, name, email, phone, postal_prefix, status, drawn_at, drawn_by, note
             FROM giveaway_entries
            WHERE giveaway = $1 AND status <> 'entered'
            ORDER BY drawn_at DESC NULLS LAST, id DESC`, [giveaway])
  ]);
  return {
    total: t[0]?.total || 0,
    optIns: t[0]?.opt_ins || 0,
    // The current winner is the newest one still standing.
    winner: w.find((r) => r.status === 'winner' || r.status === 'claimed') || null,
    history: w
  };
}

/**
 * Draw one winner from the people still in the pot. Uses the OS's CSPRNG
 * (`randomInt`), not Math.random: a prize draw has to be defensible.
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
  const { rows: pool } = await query(
    `SELECT id FROM giveaway_entries WHERE giveaway = $1 AND status = 'entered' ORDER BY id`, [giveaway]
  );
  if (!pool.length) throw new Error('There are no eligible entries to draw from.');
  const pick = pool[randomInt(pool.length)].id;
  // The status guard makes a concurrent second draw fail rather than overwrite.
  const { rows } = await query(
    `UPDATE giveaway_entries
        SET status = 'winner', drawn_at = now(), drawn_by = $2
      WHERE id = $1 AND status = 'entered'
      RETURNING id, name, email, phone, postal_prefix, status, drawn_at, drawn_by`,
    [pick, actor || null]
  );
  if (!rows.length) throw new Error('That entry changed while drawing. Please draw again.');
  return { winner: rows[0], poolSize: pool.length };
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

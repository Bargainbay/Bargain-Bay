// The password gate on a client's delivery portal.
//
// The link says WHICH client; the password says the person holding it is allowed
// in. One password per client company, set (and changed) by the office — the
// client's own people share it, so nobody has to create an account. Changing it
// signs everybody out at once, which is how a departed colleague is dealt with.
//
// FAIL CLOSED: a client with no password set cannot be opened at all. A link
// that works without a password is exactly what this exists to end.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { hasDb, query } from './db';
import { ensureJobSchema } from './jobs';

const COOKIE_PREFIX = 'bb_cp_';
const SESSION_DAYS = 30;
const WINDOW_MIN = 15;
const MAX_PER_CLIENT = 10;   // wrong guesses against one company in the window
const MAX_PER_IP = 5;        // wrong guesses from one address in the window
export const MIN_PASSWORD = 8;

export const portalCookieName = (clientId) => `${COOKIE_PREFIX}${Number(clientId)}`;

function secret() {
  return process.env.AUTH_SECRET || (process.env.NODE_ENV !== 'production' ? 'bb-dev-secret-change-me' : '');
}

// The cookie is bound to the CURRENT password: its tag is a digest of the stored
// hash, so setting a new password makes every old cookie stop verifying.
const tagOf = (hash) => crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 16);
const sign = (clientId, exp, tag) =>
  crypto.createHmac('sha256', secret()).update(`cp:${Number(clientId)}:${exp}:${tag}`).digest('hex').slice(0, 32);

export function makePortalCookie(clientId, hash, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  return { name: portalCookieName(clientId), value: `${exp}.${sign(clientId, exp, tagOf(hash))}`, maxAge: SESSION_DAYS * 86400 };
}

export function portalCookieValid(clientId, hash, value, now = Date.now()) {
  if (!secret() || !hash || !value) return false;
  const [exp, sig] = String(value).split('.');
  if (!exp || !sig || Number(exp) < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(sign(clientId, exp, tagOf(hash)));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

async function hashOf(clientId) {
  if (!hasDb()) return null;
  await ensureJobSchema();
  const { rows } = await query('SELECT portal_password_hash FROM clients WHERE id = $1 AND active = true', [Number(clientId)]);
  return rows[0]?.portal_password_hash || null;
}

// 'ok' | 'needs_password' (set, not entered) | 'no_password' (office has not set one)
export async function portalGate(clientId, cookieValue) {
  const hash = await hashOf(clientId);
  if (!hash) return 'no_password';
  return portalCookieValid(clientId, hash, cookieValue) ? 'ok' : 'needs_password';
}

export async function setClientPassword(clientId, password) {
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD) throw new Error(`The password needs at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 100) throw new Error('That password is too long.');
  await ensureJobSchema();
  const hash = await bcrypt.hash(pw, 10);
  const { rows } = await query(
    'UPDATE clients SET portal_password_hash = $2, portal_password_set_at = now() WHERE id = $1 RETURNING id',
    [Number(clientId), hash]
  );
  if (!rows[0]) throw new Error('No such client.');
  // Old attempts are no longer evidence about the new password.
  await query('DELETE FROM client_portal_attempts WHERE client_id = $1', [Number(clientId)]);
  return true;
}

export async function clearClientPassword(clientId) {
  await ensureJobSchema();
  await query('UPDATE clients SET portal_password_hash = NULL, portal_password_set_at = NULL WHERE id = $1', [Number(clientId)]);
}

// Checks a password. Counted from rows in Postgres, so the lockout holds across
// serverless instances. Returns { ok, locked, cookie? }.
export async function attemptPortalLogin(clientId, password, ip) {
  const hash = await hashOf(clientId);
  if (!hash) return { ok: false, reason: 'no_password' };
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE true)::int AS per_client,
            count(*) FILTER (WHERE ip = $2)::int AS per_ip
       FROM client_portal_attempts
      WHERE client_id = $1 AND ok = false AND at > now() - ($3 || ' minutes')::interval`,
    [Number(clientId), String(ip || ''), String(WINDOW_MIN)]
  );
  if ((rows[0]?.per_client || 0) >= MAX_PER_CLIENT || (rows[0]?.per_ip || 0) >= MAX_PER_IP) {
    return { ok: false, locked: true };
  }
  const good = await bcrypt.compare(String(password || ''), hash);
  await query('INSERT INTO client_portal_attempts (client_id, ip, ok) VALUES ($1,$2,$3)', [Number(clientId), String(ip || '') || null, good]);
  // Housekeeping: a successful or stale row older than a day is of no use.
  await query(`DELETE FROM client_portal_attempts WHERE at < now() - interval '1 day'`).catch(() => {});
  if (!good) return { ok: false };
  return { ok: true, cookie: makePortalCookie(clientId, hash) };
}

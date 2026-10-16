// Two-factor sign-in for the vendor portal: enrolment, checking a code, recovery codes, the
// lockout. The pure TOTP maths is lib/totp.js; the "has this browser been verified" cookie is
// lib/vendor-mfa-marker.js; the gate that ties it together is lib/vendor-session.js.
//
// Rules that must hold:
//  - The secret is stored ONLY encrypted (lib/secret-box.js), with the user id as AAD, so a
//    ciphertext copied onto another user's row will not decrypt. No key configured = nothing
//    can be enrolled (fails closed, like the bank details).
//  - A code can be used ONCE. `last_step` is advanced by a single conditional UPDATE, so two
//    simultaneous requests with the same code cannot both win.
//  - Recovery codes are single use, stored as a salted SHA-256, shown once.
//  - Attempts are counted in POSTGRES (serverless instances share no memory). After
//    MFA_MAX_FAILURES wrong answers in a row the user is locked out for 1 minute, doubling per
//    further failure up to MFA_LOCK_MAX_MINUTES. While locked, attempts are refused WITHOUT
//    being recorded, so the lock cannot be extended by hammering it.
//  - Answers never say which part was wrong, and nothing here logs a secret or a code.
import crypto from 'node:crypto';
import { query, withTransaction } from './db';
import { encryptSecret, decryptSecret, secretsConfigured } from './secret-box';
import { generateSecret, matchStep, otpauthUrl, groupKey } from './totp';
import { TWO_STEP_METHODS } from './vendor-permissions';
import {
  RECOVERY_CODE_COUNT, MFA_MAX_FAILURES, MFA_LOCK_MAX_MINUTES
} from './vendor-permissions';

const aad = (userId) => `vendor-mfa:${userId}`;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BAD = 'That code did not work.';

export const mfaAvailable = () => secretsConfigured();

const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const hashRecovery = (userId, code) =>
  crypto.createHash('sha256').update(`vendor-mfa-recovery:${userId}:${normRecovery(code)}`).digest('hex');

export function newRecoveryCodes(n = RECOVERY_CODE_COUNT) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = crypto.randomBytes(10);
    let s = '';
    for (const x of b) s += B32[x & 31]; // 32 symbols: no modulo bias
    out.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return out;
}

// --- state -----------------------------------------------------------------------

/** { enrolled, pending, recoveryLeft } for a user. Throws on a database error (callers fail closed). */
export async function mfaState(userId, q = query) {
  const { rows } = await q('SELECT confirmed_at FROM vendor_mfa WHERE user_id = $1', [userId]);
  const enrolled = !!rows[0]?.confirmed_at;
  let recoveryLeft = 0;
  if (enrolled) {
    const r = await q('SELECT count(*)::int AS n FROM vendor_mfa_recovery WHERE user_id = $1 AND used_at IS NULL', [userId]);
    recoveryLeft = r.rows[0].n;
  }
  return { enrolled, pending: !!rows.length && !enrolled, recoveryLeft };
}

// --- lockout ---------------------------------------------------------------------

/** { locked, retryAfterSec, failures } from the attempt log. */
export async function lockStatus(userId, q = query) {
  const { rows } = await q(
    `SELECT ok, EXTRACT(EPOCH FROM (now() - at))::float8 AS age
       FROM vendor_mfa_attempts WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT 40`, [userId]);
  let n = 0;
  for (const r of rows) { if (r.ok) break; n++; }
  if (n < MFA_MAX_FAILURES) return { locked: false, retryAfterSec: 0, failures: n };
  const lockMin = Math.min(2 ** (n - MFA_MAX_FAILURES), MFA_LOCK_MAX_MINUTES);
  const left = Math.ceil(lockMin * 60 - rows[0].age);
  return { locked: left > 0, retryAfterSec: Math.max(left, 0), failures: n };
}

async function record(userId, ok, q = query) {
  await q('INSERT INTO vendor_mfa_attempts (user_id, ok) VALUES ($1,$2)', [userId, ok]);
  if (Math.random() < 0.05) await q(`DELETE FROM vendor_mfa_attempts WHERE at < now() - interval '30 days'`).catch(() => {});
}

const lockedAnswer = (s) => ({
  ok: false, locked: true, retryAfterSec: s.retryAfterSec,
  error: `Too many wrong codes. Try again in ${Math.ceil(s.retryAfterSec / 60)} minute(s).`
});

// --- enrolment -------------------------------------------------------------------

/**
 * Start (or restart, before it is confirmed) enrolment. Returns the secret and the otpauth URL
 * for the QR — the only time the secret leaves the server. An enrolled user cannot do this: a
 * stolen session must not be able to swap the authenticator. An admin reset is the way back.
 */
export async function beginEnrolment(userId, account) {
  if (!mfaAvailable()) throw new Error('Two-factor sign-in is not available yet (the encryption key is not set). Please contact support.');
  const st = await mfaState(userId);
  if (st.enrolled) throw new Error('Two-factor sign-in is already set up. If you lost your device, use a recovery code or ask support to reset it.');
  const secret = generateSecret();
  await query(
    `INSERT INTO vendor_mfa (user_id, secret_enc) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, created_at = now(), last_step = NULL
       WHERE vendor_mfa.confirmed_at IS NULL`,
    [userId, encryptSecret(secret, aad(userId))]);
  return { secret, display: groupKey(secret), otpauthUrl: otpauthUrl({ secret, account }) };
}

async function loadSecret(userId, { confirmed }) {
  const { rows } = await query('SELECT secret_enc, confirmed_at FROM vendor_mfa WHERE user_id = $1', [userId]);
  if (!rows.length || !!rows[0].confirmed_at !== confirmed) return null;
  try { return decryptSecret(rows[0].secret_enc, aad(userId)); } catch { return null; }
}

/** Accept a TOTP code for a user exactly once. Returns the step or null. */
async function consumeTotp(userId, secret, code, nowMs) {
  const step = matchStep(secret, code, { nowMs });
  if (step === null) return null;
  const { rowCount } = await query(
    `UPDATE vendor_mfa SET last_step = $2 WHERE user_id = $1 AND (last_step IS NULL OR last_step < $2)`, [userId, step]);
  return rowCount ? step : null; // 0 rows: that step (or a later one) was already used — a replay
}

/**
 * Finish enrolment with the first code from the app. Only now is the second factor "on". Returns
 * the recovery codes — shown once, never again.
 */
export async function confirmEnrolment(userId, code, { nowMs = Date.now() } = {}) {
  const lock = await lockStatus(userId);
  if (lock.locked) return lockedAnswer(lock);
  const secret = await loadSecret(userId, { confirmed: false });
  if (!secret) return { ok: false, error: 'Start the setup again — there is nothing waiting to be confirmed.' };
  const step = await consumeTotp(userId, secret, code, nowMs);
  await record(userId, step !== null);
  if (step === null) return { ok: false, error: BAD };
  const codes = newRecoveryCodes();
  const done = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rowCount } = await q('UPDATE vendor_mfa SET confirmed_at = now() WHERE user_id = $1 AND confirmed_at IS NULL', [userId]);
    if (!rowCount) return false;
    await q('DELETE FROM vendor_mfa_recovery WHERE user_id = $1', [userId]);
    for (const rc of codes) await q('INSERT INTO vendor_mfa_recovery (user_id, code_hash) VALUES ($1,$2)', [userId, hashRecovery(userId, rc)]);
    return true;
  });
  if (!done) return { ok: false, error: 'Two-factor sign-in was already confirmed.' };
  return { ok: true, recoveryCodes: codes };
}

// --- checking a code at sign-in --------------------------------------------------

/**
 * Check an authenticator code OR a recovery code for an enrolled user. A recovery code is
 * burned on use. `totpOnly` refuses recovery codes (used when regenerating them).
 */
export async function verifyCode(userId, code, { nowMs = Date.now(), totpOnly = false } = {}) {
  const lock = await lockStatus(userId);
  if (lock.locked) return lockedAnswer(lock);
  const secret = await loadSecret(userId, { confirmed: true });
  if (!secret) return { ok: false, error: 'Two-factor sign-in is not set up for this account.' };
  const raw = String(code || '').trim();
  if (/^\d{6}$/.test(raw.replace(/\s/g, ''))) {
    const step = await consumeTotp(userId, secret, raw, nowMs);
    await record(userId, step !== null);
    return step !== null ? { ok: true, via: 'totp' } : { ok: false, error: BAD };
  }
  if (totpOnly || normRecovery(raw).length !== 10) {
    await record(userId, false);
    return { ok: false, error: BAD };
  }
  const { rowCount } = await query(
    `UPDATE vendor_mfa_recovery SET used_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, [userId, hashRecovery(userId, raw)]);
  await record(userId, rowCount > 0);
  if (!rowCount) return { ok: false, error: BAD };
  const left = (await mfaState(userId)).recoveryLeft;
  return { ok: true, via: 'recovery', recoveryLeft: left };
}

/** New recovery codes, replacing every old one. Needs a current authenticator code. */
export async function regenerateRecoveryCodes(userId, code, { nowMs } = {}) {
  const v = await verifyCode(userId, code, { nowMs, totpOnly: true });
  if (!v.ok) return v;
  const codes = newRecoveryCodes();
  await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    await q('DELETE FROM vendor_mfa_recovery WHERE user_id = $1', [userId]);
    for (const rc of codes) await q('INSERT INTO vendor_mfa_recovery (user_id, code_hash) VALUES ($1,$2)', [userId, hashRecovery(userId, rc)]);
  });
  return { ok: true, recoveryCodes: codes };
}

// --- admin recovery --------------------------------------------------------------

/**
 * Wipe a user's second factor so they must enrol again. The caller (an ADMIN, with a reason,
 * audited) decides who may; this only does it. Also bumps token_version: every session and every
 * "verified" marker the user holds dies, which is what you want if the reason was a stolen phone.
 */
export async function clearMfa(userId) {
  await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    await q('DELETE FROM vendor_mfa_recovery WHERE user_id = $1', [userId]);
    await q('DELETE FROM vendor_mfa WHERE user_id = $1', [userId]);
    await q('DELETE FROM vendor_mfa_attempts WHERE user_id = $1', [userId]);
    await q('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
  });
  return { ok: true };
}


/**
 * The user's own declaration that the account they sign in with has 2-step verification (Google or
 * Microsoft sign-in, phone text codes, an authenticator or another way). It cannot be checked from here, so
 * it is recorded as exactly what it is — a dated statement by that person — and logged against the vendor.
 * It is what allows a bank-account or team change for a user who has not enrolled the authenticator.
 */
export async function attestTwoStep(vendorId, email, method, { by } = {}) {
  if (!Object.prototype.hasOwnProperty.call(TWO_STEP_METHODS, method)) throw new Error('Choose how your sign-in is protected.');
  const e = String(email || '').trim().toLowerCase();
  const r = await withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q(
      `UPDATE vendor_users SET two_step_attested_at = now(), two_step_method = $3
        WHERE vendor_id = $1 AND lower(email) = $2 AND revoked_at IS NULL RETURNING id`, [vendorId, e, method]);
    if (!rows.length) throw new Error('No such team member.');
    await q(`INSERT INTO vendor_events (vendor_id, event, actor, detail) VALUES ($1,'two_step_declared',$2,$3)`,
      [vendorId, by || e, JSON.stringify({ method })]);
    return rows[0];
  });
  return { ok: true, id: r.id };
}

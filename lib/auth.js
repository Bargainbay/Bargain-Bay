// Email + password auth. bcryptjs for hashing, jose (HS256 JWT) for the
// session token, stored in the httpOnly 'bb_session' cookie for 30 days.
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { hasDb, query } from './db';

export const SESSION_COOKIE = 'bb_session';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  // In production a real secret is mandatory: the dev fallback is public (it
  // lives in this repo), so signing sessions with it would let anyone forge a
  // login — including an admin one. Fail loudly instead of running insecure.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET is not set — refusing to sign sessions with the public dev fallback in production.');
    }
    return new TextEncoder().encode('bb-dev-secret-change-me'); // local dev / build only
  }
  return new TextEncoder().encode(secret);
}

// --- Session revocation (token_version) ------------------------------------
// Sessions are stateless JWTs, so to make logout / password-change actually
// revoke them, each user row carries a token_version that's embedded in the
// JWT. If the live DB version has moved past the token's, the token is revoked.
// The column self-provisions, so this works without a manual migration.
let _authSchema = null;
function ensureAuthSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_authSchema) {
    _authSchema = query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0')
      .catch((e) => { _authSchema = null; throw e; });
  }
  return _authSchema;
}

async function currentTokenVersion(userId) {
  try {
    await ensureAuthSchema();
    const { rows } = await query('SELECT token_version FROM users WHERE id = $1', [userId]);
    return rows.length ? (Number(rows[0].token_version) || 0) : null;
  } catch (e) {
    // Fail open: a DB hiccup must not log everyone out. The JWT is still
    // cryptographically valid; revocation is defense-in-depth.
    console.error('token_version read failed (allowing session)', e.message);
    return null;
  }
}

// Invalidate all of a user's existing sessions (logout-everywhere / on password change).
export async function bumpTokenVersion(userId) {
  if (!hasDb() || !userId) return;
  try {
    await ensureAuthSchema();
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
  } catch (e) {
    console.error('token_version bump failed', e.message);
  }
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user) {
  // Embed the user's current token_version so a later logout / password-change
  // (which bumps it) invalidates this token. Read it live at sign time so the
  // token always matches, regardless of what the caller passed.
  let tv = typeof user?.token_version === 'number' ? user.token_version : 0;
  if (hasDb() && user?.id && typeof user?.token_version !== 'number') {
    const v = await currentTokenVersion(user.id);
    if (v != null) tv = v;
  }
  return new SignJWT({ email: user.email, name: user.name || '', tv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${THIRTY_DAYS}s`)
    .sign(secretKey());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS
  };
}

// Read + verify the session cookie. Returns { userId, email, name } or null.
// Works in server components and route handlers.
export async function getSession() {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const session = { userId: Number(payload.sub), email: payload.email, name: payload.name || '' };
    // Revocation: reject tokens issued before the user's current token_version
    // (bumped on logout / password change). Only runs for an already-valid token,
    // so anonymous traffic never hits the DB. Fail-open on DB error.
    if (hasDb() && session.userId) {
      const current = await currentTokenVersion(session.userId);
      if (current != null && current !== (Number(payload.tv) || 0)) return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function isAdmin(session) {
  if (!session?.email) return false;
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(session.email.toLowerCase());
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

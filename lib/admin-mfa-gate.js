// Two-factor sign-in for ADMIN accounts (the people who can see the books and the bank feed).
//
// It reuses the vendor portal's authenticator (lib/vendor-mfa.js: the same TOTP secret table,
// lockout and recovery codes, keyed on the user id) and adds only what is different here: a
// SEPARATE "this browser has passed the second factor" cookie (bb_amfa) and the rule that
// decides which requests need it.
//
// The rule lives in proxy.js, not in the 100+ places that call isAdmin(): one gate in front of
// every /admin page, /api/admin route and Plaid route cannot be forgotten by a new route.
//
// SAFE TO SWITCH ON. Nothing is enforced until ADMIN_MFA=on (and the encryption key that an
// authenticator secret needs is set), so the owner can enrol first and cannot lock themselves
// out by deploying. Unsetting ADMIN_MFA turns it off again — the break-glass.
//
// No database and no `next/headers` in this file: the proxy imports it. The marker carries the
// session's token_version, so it dies with the session (logout / password change / reset).
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { MFA_MARKER_HOURS } from './vendor-permissions.js';

export const ADMIN_MARKER_COOKIE = 'bb_amfa';
const SESSION_COOKIE = 'bb_session';

export const adminMfaEnforced = () => process.env.ADMIN_MFA === 'on' && !!process.env.BANK_ENCRYPTION_KEY;

const emails = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function sessionKey() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not set.');
  return new TextEncoder().encode(s || 'bb-dev-secret-change-me');
}
function markerKey() {
  const base = process.env.AUTH_SECRET || 'bb-dev-secret-change-me';
  return crypto.createHmac('sha256', base).update('admin-mfa-marker-v1').digest();
}

export async function signAdminMarker(userId, tv, { nowMs = Date.now() } = {}) {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ purpose: 'amfa', tv: Number(tv) || 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt(iat)
    .setExpirationTime(iat + MFA_MARKER_HOURS * 3600)
    .sign(markerKey());
}

export const adminMarkerCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: MFA_MARKER_HOURS * 3600
});

/** True when this marker belongs to this user AND this session generation. Never throws. */
export async function adminMarkerValid(token, userId, tv, { nowMs = Date.now() } = {}) {
  try {
    if (!token || !userId) return false;
    const { payload } = await jwtVerify(String(token), markerKey(), { algorithms: ['HS256'], currentDate: new Date(nowMs) });
    return payload.purpose === 'amfa' && payload.sub === String(userId) && (Number(payload.tv) || 0) === (Number(tv) || 0);
  } catch {
    return false;
  }
}

// Surfaces that need the second factor, and the two that must not (they are where it is done).
const PROTECTED = [/^\/admin(\/|$)/, /^\/api\/admin(\/|$)/, /^\/api\/plaid(\/|$)/, /^\/sales(\/|$)/, /^\/api\/sales(\/|$)/];
const OPEN = [/^\/admin\/security(\/|$)/, /^\/api\/admin\/mfa$/, /^\/api\/plaid\/webhook$/];
export const isProtectedPath = (p) => PROTECTED.some((re) => re.test(p)) && !OPEN.some((re) => re.test(p));

/**
 * Does this request have to be stopped and sent to the second factor? Pure: the proxy hands in
 * the two cookie values. Anything that is not clearly "an admin with no valid marker" is let
 * through — a signed-out visitor is the page's own login redirect to handle, and a non-admin is
 * refused by the route itself exactly as before.
 */
export async function needsAdminMfa({ pathname, sessionToken, markerToken, nowMs = Date.now() }) {
  if (!adminMfaEnforced() || !isProtectedPath(pathname) || !sessionToken) return false;
  let p;
  try { ({ payload: p } = await jwtVerify(String(sessionToken), sessionKey(), { algorithms: ['HS256'] })); } catch { return false; }
  if (!p?.email || !emails().includes(String(p.email).toLowerCase())) return false;
  return !(await adminMarkerValid(markerToken, p.sub, p.tv, { nowMs }));
}

export { SESSION_COOKIE as ADMIN_SESSION_COOKIE };

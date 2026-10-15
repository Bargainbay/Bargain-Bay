// The "this browser has passed the second factor" marker for the vendor portal.
//
// A SEPARATE signed, httpOnly cookie (bb_vmfa) — not a claim in bb_session — so customers,
// staff and drivers sign in exactly as before and nothing about their sessions changes. It
// is bound to the user (sub) and to their token_version: a password change or any
// "sign out everywhere" bumps token_version and the marker dies with the session. It is signed
// with a key DERIVED from AUTH_SECRET, so a bb_session token can never be replayed as a marker
// or the other way round. `at` is when a code was last actually entered; step-up checks read it.
//
// Every failure here means "no marker" — the gate then asks for the code. Nothing fails open.
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { query } from './db';
import { MFA_MARKER_HOURS } from './vendor-permissions';

export const MARKER_COOKIE = 'bb_vmfa';

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not set.');
  const base = secret || 'bb-dev-secret-change-me';
  return crypto.createHmac('sha256', base).update('vendor-mfa-marker-v1').digest();
}

// Read live and FAIL CLOSED: unlike lib/auth's own check (which lets a session through when the
// database hiccups), a marker we cannot check against the user's token_version is not a marker.
async function liveTokenVersion(userId) {
  const { rows } = await query('SELECT token_version FROM users WHERE id = $1', [userId]);
  return rows.length ? Number(rows[0].token_version) || 0 : null;
}

/** A fresh marker for a user who has JUST entered a code. */
export async function signMarker(userId, { nowMs = Date.now() } = {}) {
  const tv = await liveTokenVersion(userId);
  if (tv === null) throw new Error('No such user.');
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ purpose: 'vmfa', tv, at: iat })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt(iat)
    .setExpirationTime(iat + MFA_MARKER_HOURS * 3600)
    .sign(key());
}

export const markerCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: MFA_MARKER_HOURS * 3600
});

/** Verify a marker token for this user. Returns { atMs } or null. */
export async function readMarkerToken(token, userId, { nowMs = Date.now() } = {}) {
  try {
    if (!token || !userId) return null;
    const { payload } = await jwtVerify(String(token), key(), { algorithms: ['HS256'], currentDate: new Date(nowMs) });
    if (payload.purpose !== 'vmfa' || payload.sub !== String(userId)) return null;
    const live = await liveTokenVersion(userId);
    if (live === null || live !== (Number(payload.tv) || 0)) return null;
    const at = Number(payload.at);
    if (!Number.isFinite(at)) return null;
    return { atMs: at * 1000 };
  } catch {
    return null;
  }
}

/** The marker on the current request, for this session's user. */
export async function currentMarker(session, opts) {
  try {
    const jar = await cookies();
    return await readMarkerToken(jar.get(MARKER_COOKIE)?.value, session?.userId, opts);
  } catch {
    return null;
  }
}

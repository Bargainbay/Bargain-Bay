// Email + password auth. bcryptjs for hashing, jose (HS256 JWT) for the
// session token, stored in the httpOnly 'bb_session' cookie for 30 days.
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'bb_session';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function secretKey() {
  // Fallback keeps local dev / build working; set AUTH_SECRET in production.
  const secret = process.env.AUTH_SECRET || 'bb-dev-secret-change-me';
  return new TextEncoder().encode(secret);
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user) {
  return new SignJWT({ email: user.email, name: user.name || '' })
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
    return { userId: Number(payload.sub), email: payload.email, name: payload.name || '' };
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

// TOTP (RFC 6238) over HOTP (RFC 4226), HMAC-SHA1, 6 digits, 30-second step — what every
// authenticator app speaks. node:crypto only: no dependency to keep patched in authentication.
import crypto from 'node:crypto';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not a valid base32 secret.');
    value = ((value << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** 160 bits, the RFC 4226 recommendation. */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secretBuf, counter, { digits = DIGITS, algorithm = 'sha1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algorithm, secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** The code for a base32 secret at a moment. */
export function totp(secretB32, nowMs = Date.now(), opts = {}) {
  return hotp(base32Decode(secretB32), stepAt(nowMs), opts);
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Which step does this code belong to, within +-window steps of now? Returns the step number, or
 * null. Every candidate is compared (no early exit) so timing does not say which step matched.
 * The CALLER must refuse a step it has already accepted — that is replay protection, and it has
 * to be atomic with the write, so it lives in the database (lib/vendor-mfa.js).
 */
export function matchStep(secretB32, code, { nowMs = Date.now(), window = 1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(nowMs);
  let hit = null;
  for (let d = -window; d <= window; d++) {
    if (safeEq(hotp(secret, now + d), c) && hit === null) hit = now + d;
  }
  return hit;
}

export function otpauthUrl({ secret, account, issuer = 'Bargain Bay Marketplace' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** A human-typable key in groups of four. */
export const groupKey = (s) => String(s).replace(/(.{4})/g, '$1 ').trim();

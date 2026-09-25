// Unguessable, stable access tokens for hosted record links (the `?t=` param on
// /invoice/[number], /quote/[number], /order/[orderNumber]). The token is an
// HMAC of the record's public number keyed by the server secret (AUTH_SECRET),
// so it can't be forged or guessed from the (sequential) number — closing the
// "anyone who knows the customer's email can enumerate their records" IDOR. It's
// derived, not stored, so there's no DB column or migration.
import crypto from 'crypto';

function secret() {
  // Reuse the session secret. In production AUTH_SECRET is mandatory (lib/auth
  // throws without it); the dev fallback matches lib/auth for local/build only.
  return process.env.AUTH_SECRET || (process.env.NODE_ENV !== 'production' ? 'bb-dev-secret-change-me' : '');
}

// kind: 'invoice' | 'quote' | 'order'. id: the public number (e.g. 'INV-1042').
export function linkToken(kind, id) {
  const s = secret();
  if (!s || !id) return '';
  return crypto.createHmac('sha256', s).update(`${kind}:${id}`).digest('hex').slice(0, 24);
}

export function verifyLinkToken(kind, id, token) {
  const expected = linkToken(kind, id);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

// ---- unsubscribe -----------------------------------------------------------
// Same HMAC trick, for the opt-out link in a marketing email. Derived rather
// than stored, so there is no token table to expire and no migration — which
// also satisfies CASL's requirement that the mechanism stay valid for at least
// 60 days, for free and forever.
//
// The identity is in the URL so the page can say WHICH address it is about
// ("stop emailing bob@example.com"), and the token is what stops anyone
// unsubscribing somebody else by typing their address into the query string.
export const unsubToken = (identity) =>
  linkToken('unsub', String(identity || '').trim().toLowerCase());

export const verifyUnsubToken = (identity, token) =>
  verifyLinkToken('unsub', String(identity || '').trim().toLowerCase(), token);

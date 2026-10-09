// "Sign in with Google / Microsoft" -- plain OAuth 2.0 authorization-code flow,
// no library. Each provider is dormant until its two env vars are set, and the
// buttons only render for a configured provider.
//
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   MS_LOGIN_CLIENT_ID / MS_LOGIN_CLIENT_SECRET
//
// MS_LOGIN_* is deliberately NOT MS_CLIENT_ID: that one is the CDA workbook
// watcher's app, with Files.Read.All consent. A customer-facing login must not
// share an app registration with a file-reading scope.
//
// Redirect URI to register with each provider:
//   <SITE_URL>/api/auth/oauth/<google|microsoft>/callback
//
// TRUST RULES (each is an account-takeover door if wrong):
//  * We read the person's email from the provider's userinfo endpoint, fetched
//    server-to-server with the code we just exchanged -- never from the browser.
//  * Google: only with email_verified = true.
//  * Microsoft: only PERSONAL accounts (Hotmail / Outlook / Live). A work or
//    school tenant admin controls the `email` claim and can set it to anybody's
//    address, so an org account is refused rather than trusted.
//  * The match is by (provider, subject) once linked; the email is used only to
//    attach to an existing account the first time.
//  * Attaching to a PASSWORD account that has never used OAuth resets its
//    password and kills its sessions. Signup does not verify email, so that
//    account may have been pre-registered by someone else who knows the
//    password ("pre-hijacking"); the real owner just proved they own the
//    address and can set a new password with "forgot password".
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { hasDb, query } from './db';
import { normalizeEmail, validEmail, bumpTokenVersion } from './auth';
import { upsertCustomer } from './customers';
import { grantConsent } from './consent';
import { CONSENT_TEXT } from './consent-text';
import { isBlocked, isDisposableEmail, checkSignupRate, ensureAbuseSchema } from './antifraud';

// Microsoft's fixed tenant id for personal (consumer) accounts.
export const MS_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const STATE_COOKIE = 'bb_oauth';

const PROVIDERS = {
  google: {
    label: 'Google',
    idVar: 'GOOGLE_CLIENT_ID', secretVar: 'GOOGLE_CLIENT_SECRET',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' }
  },
  microsoft: {
    label: 'Microsoft',
    idVar: 'MS_LOGIN_CLIENT_ID', secretVar: 'MS_LOGIN_CLIENT_SECRET',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' }
  }
};

export const isProvider = (p) => Object.prototype.hasOwnProperty.call(PROVIDERS, p);
export const providerLabel = (p) => PROVIDERS[p]?.label || p;
const configured = (p) => !!(process.env[PROVIDERS[p].idVar] && process.env[PROVIDERS[p].secretVar]);

/** Providers with credentials set, for the login and signup screens. */
export function oauthProviders() {
  return Object.keys(PROVIDERS).filter(configured).map((id) => ({ id, label: PROVIDERS[id].label }));
}

export function redirectUri(provider, base) {
  const origin = String(base || process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

/** Only ever a path on this site. An open redirect after login is a phishing aid. */
export function safeNext(next) {
  const n = String(next || '');
  if (!n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\') || /[\r\n]/.test(n)) return '/account';
  return n;
}

export const newState = () => crypto.randomBytes(24).toString('base64url');

export function authorizeUrl(provider, { state, base } = {}) {
  const p = PROVIDERS[provider];
  if (!p || !configured(provider)) return null;
  const u = new URL(p.authUrl);
  u.searchParams.set('client_id', process.env[p.idVar]);
  u.searchParams.set('redirect_uri', redirectUri(provider, base));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('state', state);
  for (const [k, v] of Object.entries(p.extra || {})) u.searchParams.set(k, v);
  return u.toString();
}

const decodePayload = (jwt) => {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
};

/**
 * Exchange the code and read who this is. Returns
 * { subject, email, emailVerified, name } or throws an Error whose message is
 * safe to show. `fetchImpl` is injectable for tests.
 */
export async function fetchIdentity(provider, code, { base, fetchImpl = fetch } = {}) {
  const p = PROVIDERS[provider];
  if (!p || !configured(provider)) throw new Error('That sign-in method is not available.');

  const tokRes = await fetchImpl(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env[p.idVar], client_secret: process.env[p.secretVar],
      code, grant_type: 'authorization_code', redirect_uri: redirectUri(provider, base)
    }).toString()
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.access_token) throw new Error(`${p.label} did not accept the sign-in. Please try again.`);

  const infoRes = await fetchImpl(p.userinfoUrl, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.sub) throw new Error(`Could not read your ${p.label} profile. Please try again.`);

  const email = normalizeEmail(info.email);
  if (provider === 'google') {
    return { subject: String(info.sub), email, emailVerified: info.email_verified === true, name: info.name || '' };
  }
  // Microsoft: personal accounts only (see the trust rules above). `tid` is in
  // the id_token we just received from the token endpoint over TLS.
  const tid = decodePayload(tok.id_token).tid;
  if (tid !== MS_PERSONAL_TENANT) {
    throw new Error('Please use a personal Microsoft account (Hotmail, Outlook or Live). Work and school accounts cannot be used here.');
  }
  return { subject: String(info.sub), email, emailVerified: true, name: info.name || '' };
}

const UNUSABLE = () => `!oauth:${crypto.randomBytes(8).toString('hex')}`;

/**
 * Find or create the account for a verified external identity.
 * Returns { ok: true, user, created } or { ok: false, error, status }.
 */
export async function resolveOAuthUser({ provider, subject, email, emailVerified, name, ip } = {}) {
  if (!hasDb()) return { ok: false, status: 503, error: 'Accounts are not available yet — database not configured.' };
  const mail = normalizeEmail(email);
  if (!subject) return { ok: false, status: 400, error: 'Sign-in failed. Please try again.' };
  if (!mail || !validEmail(mail) || !emailVerified) {
    return { ok: false, status: 400, error: 'We need a verified email address from that account. Please use another sign-in method.' };
  }

  // 1. Already linked → that account, whatever the email says today.
  const linked = await query(
    `SELECT u.id, u.email, u.name FROM user_identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.subject = $2`, [provider, subject]);
  if (linked.rows.length) {
    await query(`UPDATE user_identities SET last_login = now() WHERE provider = $1 AND subject = $2`, [provider, subject]);
    return { ok: true, user: linked.rows[0], created: false };
  }

  // The same abuse gates as password signup: this is the same door.
  await ensureAbuseSchema().catch(() => {});
  if (await isBlocked({ email: mail, ip })) {
    return { ok: false, status: 403, error: 'We are unable to sign you in. Please contact sales@bargainbay.ca.' };
  }

  const existing = await query(`SELECT id, email, name FROM users WHERE email = $1`, [mail]);
  if (existing.rows.length) {
    const user = existing.rows[0];
    const hadIdentity = (await query(`SELECT 1 FROM user_identities WHERE user_id = $1 LIMIT 1`, [user.id])).rows.length > 0;
    await query(
      `INSERT INTO user_identities (user_id, provider, subject, email, last_login) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (provider, subject) DO NOTHING`, [user.id, provider, subject, mail]);
    if (!hadIdentity) {
      // Pre-hijacking guard (see top of file). Only when the stored hash is a
      // real one: an OAuth-only account has nothing to reset.
      const h = (await query(`SELECT password_hash FROM users WHERE id = $1`, [user.id])).rows[0]?.password_hash || '';
      if (!h.startsWith('!oauth')) {
        await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, UNUSABLE()]);
        await bumpTokenVersion(user.id);
      }
    }
    return { ok: true, user, created: false };
  }

  // 2. A new account.
  if (isDisposableEmail(mail)) {
    return { ok: false, status: 400, error: 'Please use a permanent email address so we can reach you about your orders.' };
  }
  const rate = await checkSignupRate({ ip });
  if (!rate.ok) return { ok: false, status: 429, error: 'Too many accounts created from this connection. Please try again later.' };

  const nm = String(name || '').trim() || mail.split('@')[0];
  const { rows } = await query(
    `INSERT INTO users (email, name, password_hash, signup_ip) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO NOTHING RETURNING id, email, name`,
    [mail, nm, await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), ip && ip !== 'unknown' ? ip : null]
  );
  if (!rows.length) return { ok: false, status: 409, error: 'Please try signing in again.' };
  const user = rows[0];
  await query(
    `INSERT INTO user_identities (user_id, provider, subject, email, last_login) VALUES ($1,$2,$3,$4,now())`,
    [user.id, provider, subject, mail]);
  // Claim guest orders placed with this (now verified) address, as signup does.
  await query('UPDATE orders SET user_id = $1 WHERE user_id IS NULL AND email = $2', [user.id, mail]).catch(() => {});
  await upsertCustomer({ email: mail, name: nm, userId: user.id }).catch(() => {});
  return { ok: true, user, created: true };
}

/**
 * Express marketing consent for a person who signed up through Google/Microsoft.
 * ONLY for a newly created account AND only if they ticked the (unticked-by-
 * default) box on this visit. An existing account signing in again is not a yes,
 * and neither is an unticked box. Evidence is the exact wording they were shown.
 * Never throws: consent bookkeeping must not fail a sign-in.
 */
export async function recordOAuthOptIn({ created, optin, email, provider, ip } = {}) {
  if (created !== true || optin !== true || !email) return false;
  try {
    const r = await grantConsent({
      channel: 'email', email, source: 'signup', ip,
      evidence: `${CONSENT_TEXT} (ticked before signing up with ${provider})`
    });
    return !!r;
  } catch (e) {
    console.error('oauth consent record failed', e.message);
    return false;
  }
}

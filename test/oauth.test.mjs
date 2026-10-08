// lib/oauth.js — sign in with Google / Microsoft.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import {
  safeNext, authorizeUrl, oauthProviders, fetchIdentity, resolveOAuthUser, MS_PERSONAL_TENANT
} from '../lib/oauth.js';

const fresh = () => withTestDb();
const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
const fakeFetch = (info, idToken) => async (url) => {
  if (String(url).includes('token')) return { ok: true, json: async () => ({ access_token: 'at', id_token: idToken }) };
  return { ok: true, json: async () => info };
};

suite('OAuth login — plumbing');

test('providers are dormant until both env vars are set', () => {
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  equal(oauthProviders().length, 0);
  equal(authorizeUrl('google', { state: 's' }), null);
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
  equal(oauthProviders().map((p) => p.id), ['google']);
  const u = new URL(authorizeUrl('google', { state: 's1', base: 'https://bargainbay.ca' }));
  equal(u.searchParams.get('state'), 's1');
  equal(u.searchParams.get('redirect_uri'), 'https://bargainbay.ca/api/auth/oauth/google/callback');
});

test('next can only be a path on this site', () => {
  equal(safeNext('/checkout'), '/checkout');
  equal(safeNext('//evil.com'), '/account');
  equal(safeNext('https://evil.com'), '/account');
  equal(safeNext('/\\evil.com'), '/account');
  equal(safeNext(''), '/account');
});

test('Google: an unverified email is reported as unverified', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
  const id = await fetchIdentity('google', 'c', { fetchImpl: fakeFetch({ sub: '1', email: 'A@B.ca', email_verified: false }) });
  equal(id.emailVerified, false);
  equal(id.email, 'a@b.ca');
});

test('Microsoft: personal accounts only — a work tenant is refused', async () => {
  process.env.MS_LOGIN_CLIENT_ID = 'cid'; process.env.MS_LOGIN_CLIENT_SECRET = 'sec';
  const ok = await fetchIdentity('microsoft', 'c', { fetchImpl: fakeFetch({ sub: 'm1', email: 'h@hotmail.com' }, jwt({ tid: MS_PERSONAL_TENANT })) });
  equal(ok.emailVerified, true);
  let err = null;
  try { await fetchIdentity('microsoft', 'c', { fetchImpl: fakeFetch({ sub: 'm2', email: 'ceo@victim.com' }, jwt({ tid: 'some-org-tenant' })) }); }
  catch (e) { err = e; }
  assert(err && /personal Microsoft/.test(err.message), 'work accounts must be refused');
});

suite('OAuth login — accounts');

test('a new verified identity creates an account and links it', async () => {
  const { done } = await fresh();
  try {
    const r = await resolveOAuthUser({ provider: 'google', subject: 'g1', email: 'New@Person.ca', emailVerified: true, name: 'New P', ip: '1.2.3.4' });
    assert(r.ok && r.created);
    equal(r.user.email, 'new@person.ca');
    equal((await query('SELECT count(*)::int n FROM user_identities')).rows[0].n, 1);
  } finally { done(); }
});

test('the same identity signs back in to the same account, even if the email changed', async () => {
  const { done } = await fresh();
  try {
    const a = await resolveOAuthUser({ provider: 'google', subject: 'g1', email: 'old@x.ca', emailVerified: true, name: 'A' });
    const b = await resolveOAuthUser({ provider: 'google', subject: 'g1', email: 'renamed@x.ca', emailVerified: true, name: 'A' });
    assert(b.ok && !b.created);
    equal(b.user.id, a.user.id);
  } finally { done(); }
});

test('an unverified email is refused', async () => {
  const { done } = await fresh();
  try {
    const r = await resolveOAuthUser({ provider: 'google', subject: 'g9', email: 'a@b.ca', emailVerified: false });
    equal(r.ok, false);
    equal((await query('SELECT count(*)::int n FROM users')).rows[0].n, 0);
  } finally { done(); }
});

test('attaching to an existing PASSWORD account kills its password and sessions', async () => {
  const { done } = await fresh();
  try {
    await query(`INSERT INTO users (email, name, password_hash) VALUES ('pre@x.ca','Pre','$2a$10$realbcrypthashvalue')`);
    const r = await resolveOAuthUser({ provider: 'google', subject: 'g5', email: 'pre@x.ca', emailVerified: true });
    assert(r.ok && !r.created, 'attaches rather than duplicating');
    const h = (await query(`SELECT password_hash FROM users WHERE email='pre@x.ca'`)).rows[0].password_hash;
    assert(h.startsWith('!oauth'), 'the old password no longer works');
    // second provider on the same account does not reset anything again
    const r2 = await resolveOAuthUser({ provider: 'microsoft', subject: 'm5', email: 'pre@x.ca', emailVerified: true });
    equal(r2.user.id, r.user.id);
  } finally { done(); }
});

test('a guest order placed with that email is claimed on first sign-in', async () => {
  const { done } = await fresh();
  try {
    await query(`INSERT INTO orders (email, status) VALUES ('guest@x.ca','confirmed')`);
    const r = await resolveOAuthUser({ provider: 'google', subject: 'g7', email: 'guest@x.ca', emailVerified: true });
    equal((await query('SELECT user_id FROM orders')).rows[0].user_id, r.user.id);
  } finally { done(); }
});
